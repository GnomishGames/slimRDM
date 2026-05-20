use std::sync::Arc;
use serde::{Deserialize, Serialize};

use sha2::{Digest, Sha256};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

use crate::store::AuthType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpHostParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub credential_ref: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
}

/// Opens a direct-tcpip channel through a jump host and returns a DuplexStream
/// that is bidirectionally bridged to it. The returned stream can be passed
/// directly to russh::client::connect_stream or used as a TCP transport for RDP.
pub async fn open_jump_channel(
    params: &JumpHostParams,
    target_host: &str,
    target_port: u16,
) -> Result<tokio::io::DuplexStream, String> {
    use russh::{client, ChannelMsg};
    use russh_keys::key;
    use async_trait::async_trait;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct JumpHostHandler {
        host: String,
    }

    #[async_trait]
    impl client::Handler for JumpHostHandler {
        type Error = russh::Error;
        async fn check_server_key(
            &mut self,
            server_public_key: &key::PublicKey,
        ) -> Result<bool, Self::Error> {
            let fp = BASE64.encode(Sha256::digest(format!("{server_public_key:?}").as_bytes()));
            Ok(crate::commands::known_hosts::check_or_store(&self.host, &fp).unwrap_or(false))
        }
    }

    let config = Arc::new(client::Config::default());
    let mut session = client::connect(
        config,
        format!("{}:{}", params.host, params.port),
        JumpHostHandler { host: params.host.clone() },
    )
    .await
    .map_err(|e| format!("Jump host connect failed: {e}"))?;

    let authenticated = match &params.auth_type {
        AuthType::Password => {
            let pw = params.credential_ref.as_deref()
                .and_then(crate::commands::credentials::get_credential_sync)
                .unwrap_or_default();
            session
                .authenticate_password(&params.username, &pw)
                .await
                .map_err(|e| format!("Jump host auth failed: {e}"))?
        }
        AuthType::PublicKey => {
            let path = params
                .private_key_path
                .as_deref()
                .ok_or("No private key path provided for jump host")?;
            let passphrase = params.private_key_passphrase.as_deref();
            let key_pair = russh_keys::load_secret_key(path, passphrase)
                .map_err(|e| format!("Jump host key load failed: {e}"))?;
            session
                .authenticate_publickey(&params.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("Jump host key auth failed: {e}"))?
        }
        AuthType::Agent => {
            return Err("SSH agent auth not supported for jump host".into());
        }
    };

    if !authenticated {
        return Err("Jump host authentication rejected".into());
    }

    let mut channel = session
        .channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0)
        .await
        .map_err(|e| format!("direct-tcpip channel open failed: {e}"))?;

    // Pipe both directions through an in-memory DuplexStream so the caller
    // gets a type that is Send + Sync + Unpin (needed by both connect_stream
    // and ironrdp-tokio's split_tokio_framed via TLS).
    let (client_side, server_side) = tokio::io::duplex(65536);

    tokio::spawn(async move {
        // Keep the jump session alive for the duration of the tunnel.
        let _session = session;

        let (mut pipe_read, mut pipe_write) = tokio::io::split(server_side);
        let mut read_buf = vec![0u8; 32768];

        loop {
            tokio::select! {
                // Remote → local: receive data from the SSH channel
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            if pipe_write.write_all(data).await.is_err() {
                                break;
                            }
                        }
                        None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                        _ => {}
                    }
                }
                // Local → remote: send data received from the pipe into the SSH channel
                n = pipe_read.read(&mut read_buf) => {
                    match n {
                        Ok(0) | Err(_) => {
                            let _ = channel.eof().await;
                            break;
                        }
                        Ok(n) => {
                            if channel.data(&read_buf[..n]).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }
    });

    Ok(client_side)
}
