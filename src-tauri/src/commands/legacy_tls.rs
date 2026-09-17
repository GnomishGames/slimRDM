//! TLS upgrade for RDP servers that predate modern cipher suites.
//!
//! `ironrdp-tls` is built on rustls here, and rustls implements AEAD cipher
//! suites only. Some Windows hosts — whether by age or by a hardened Schannel
//! configuration — offer nothing but CBC suites and sign their self-signed RDP
//! certificate with SHA-1, so there is no suite in common: the server resets
//! the socket mid-handshake instead of sending an alert. This module runs the
//! same upgrade through a TLS stack that still speaks those suites, so `rdp.rs`
//! can retry with it when the strict handshake is refused.
//!
//! On Linux that stack is OpenSSL, which is already linked in through
//! reqwest's native-tls backend, and that arm is what the tests below cover.
//! Elsewhere it is native-tls itself: Schannel and Security.framework still
//! negotiate these suites by default — mstsc reaches these servers the same way
//! — but native-tls exposes no security level to lower, so that arm is a best
//! effort and is not exercised here.

use std::io;

use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt as _};
use x509_cert::der::Decode as _;

fn cert_from_der(der: &[u8]) -> io::Result<x509_cert::Certificate> {
    x509_cert::Certificate::from_der(der).map_err(io::Error::other)
}

#[cfg(target_os = "linux")]
pub type LegacyTlsStream<S> = tokio_openssl::SslStream<S>;
#[cfg(not(target_os = "linux"))]
pub type LegacyTlsStream<S> = tokio_native_tls::TlsStream<S>;

/// Wrap `stream` in TLS, accepting the ciphers and SHA-1 signatures modern
/// defaults refuse. Returns the stream and the server certificate, whose public
/// key CredSSP binds the authentication to.
#[cfg(target_os = "linux")]
pub async fn upgrade<S>(stream: S, server_name: &str) -> io::Result<(LegacyTlsStream<S>, x509_cert::Certificate)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    use std::pin::Pin;

    use openssl::ssl::{SslConnector, SslMethod, SslSessionCacheMode, SslVerifyMode, SslVersion};

    let mut builder = SslConnector::builder(SslMethod::tls_client()).map_err(io::Error::other)?;

    // RDP certificates are self-signed; the strict path does not verify them
    // either. What protects the session is CredSSP binding to the public key
    // extracted below.
    builder.set_verify(SslVerifyMode::NONE);

    // Security level 0 is the whole point of this path. It is what makes
    // OpenSSL offer CBC cipher suites *and* advertise rsa_pkcs1_sha1 — from
    // level 1 up it strips the SHA-1 signature algorithm, and a server whose
    // only certificate is SHA-1 signed then has nothing it can present.
    builder.set_security_level(0);
    // The level alone does not widen the suite list: the system openssl.cnf has
    // already narrowed it at context creation. What is excluded matters as much
    // as what is offered, because resetting the strict handshake is enough to
    // force a session onto this path: `ALL` keeps aNULL (no certificate at all,
    // so nothing for CredSSP to bind to) and level 0 readmits the broken
    // families, leaving the weakest suite the server accepts up to whoever
    // provoked the retry. Excluding them still leaves every CBC suite these
    // hosts actually need — ECDHE-RSA-AES256-SHA384 and ECDHE-RSA-AES128-SHA
    // among them.
    builder
        .set_cipher_list("ALL:!aNULL:!eNULL:!3DES:!DES:!RC4:!MD5:!EXPORT:!SEED:!IDEA")
        .map_err(io::Error::other)?;
    builder
        .set_min_proto_version(Some(SslVersion::TLS1))
        .map_err(io::Error::other)?;

    // > The CredSSP Protocol does not extend the TLS wire protocol. TLS session
    // > resumption is not supported.
    //
    // source: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cssp/385a7489-d46b-464c-b224-f7340e308a5c
    builder.set_session_cache_mode(SslSessionCacheMode::OFF);

    // rustls sends SNI for a DNS name and omits it for an IP literal. Mirroring
    // that matters because the retry has to reach the same certificate the
    // first attempt saw: a host that selects by SNI would otherwise hand the
    // fallback a different key, and CredSSP binds to the key.
    let ssl = builder
        .build()
        .configure()
        .map_err(io::Error::other)?
        .use_server_name_indication(server_name.parse::<std::net::IpAddr>().is_err())
        .verify_hostname(false)
        .into_ssl(server_name)
        .map_err(io::Error::other)?;

    let mut tls_stream = tokio_openssl::SslStream::new(ssl, stream).map_err(io::Error::other)?;
    Pin::new(&mut tls_stream)
        .connect()
        .await
        .map_err(io::Error::other)?;
    tls_stream.flush().await?;

    let cert = tls_stream
        .ssl()
        .peer_certificate()
        .ok_or_else(|| io::Error::other("peer certificate is missing"))?
        .to_der()
        .map_err(io::Error::other)?;

    Ok((tls_stream, cert_from_der(&cert)?))
}

/// Wrap `stream` in TLS, accepting the ciphers and SHA-1 signatures modern
/// defaults refuse. Returns the stream and the server certificate, whose public
/// key CredSSP binds the authentication to.
#[cfg(not(target_os = "linux"))]
pub async fn upgrade<S>(stream: S, server_name: &str) -> io::Result<(LegacyTlsStream<S>, x509_cert::Certificate)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    use tokio_native_tls::native_tls::{Protocol, TlsConnector};

    // native-tls exposes no way to disable TLS session resumption, which
    // CredSSP does not support (MS-CSSP). Schannel caches client sessions per
    // process, so a second connection to the same host in one run can resume
    // and fail authentication where the first succeeded. Unsolved here; the
    // Linux arm turns the cache off explicitly.
    let connector = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .min_protocol_version(Some(Protocol::Tlsv10))
        .use_sni(server_name.parse::<std::net::IpAddr>().is_err())
        .build()
        .map_err(io::Error::other)?;

    let mut tls_stream = tokio_native_tls::TlsConnector::from(connector)
        .connect(server_name, stream)
        .await
        .map_err(io::Error::other)?;
    tls_stream.flush().await?;

    let cert = tls_stream
        .get_ref()
        .peer_certificate()
        .map_err(io::Error::other)?
        .ok_or_else(|| io::Error::other("peer certificate is missing"))?
        .to_der()
        .map_err(io::Error::other)?;

    Ok((tls_stream, cert_from_der(&cert)?))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use openssl::asn1::Asn1Time;
    use openssl::hash::MessageDigest;
    use openssl::pkey::PKey;
    use openssl::rsa::Rsa;
    use openssl::ssl::{SslAcceptor, SslMethod, SslVersion};
    use openssl::x509::{X509, X509NameBuilder};
    use tokio::net::{TcpListener, TcpStream};

    /// Stand-in for a pre-2012 Schannel RDP host: TLS 1.2 at best, CBC cipher
    /// suites only, and a SHA-1 signed self-signed certificate.
    async fn legacy_only_server() -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
        let rsa = Rsa::generate(2048).unwrap();
        let key = PKey::from_rsa(rsa).unwrap();

        let mut name = X509NameBuilder::new().unwrap();
        name.append_entry_by_text("CN", "LEGACY.example.test").unwrap();
        let name = name.build();

        let mut cert = X509::builder().unwrap();
        cert.set_version(2).unwrap();
        cert.set_subject_name(&name).unwrap();
        cert.set_issuer_name(&name).unwrap();
        cert.set_pubkey(&key).unwrap();
        cert.set_not_before(&Asn1Time::days_from_now(0).unwrap()).unwrap();
        cert.set_not_after(&Asn1Time::days_from_now(30).unwrap()).unwrap();
        cert.sign(&key, MessageDigest::sha1()).unwrap();
        let cert = cert.build();

        let mut acceptor = SslAcceptor::mozilla_intermediate(SslMethod::tls()).unwrap();
        // Signing and serving a SHA-1 certificate is itself below the default
        // security level, so the stand-in has to drop to 0 the same way.
        acceptor.set_security_level(0);
        acceptor.set_cipher_list("ECDHE-RSA-AES256-SHA384:ECDHE-RSA-AES128-SHA:@SECLEVEL=0").unwrap();
        // Signing with SHA-1 only is what exercises `set_security_level(0)` in
        // the client above: OpenSSL strips rsa_pkcs1_sha1 from its advertised
        // signature algorithms at level 1 and up, and this server then has no
        // algorithm it can sign with. It is not what defeats rustls — ironrdp-tls
        // builds its verifier with RSA_PKCS1_SHA1 in `supported_verify_schemes`,
        // so rustls does advertise it; rustls fails on the cipher list alone.
        acceptor.set_sigalgs_list("RSA+SHA1").unwrap();
        acceptor.set_max_proto_version(Some(SslVersion::TLS1_2)).unwrap();
        acceptor.set_private_key(&key).unwrap();
        acceptor.set_certificate(&cert).unwrap();
        let acceptor = acceptor.build();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let ssl = openssl::ssl::Ssl::new(acceptor.context()).unwrap();
            let mut tls = tokio_openssl::SslStream::new(ssl, stream).unwrap();
            let _ = std::pin::Pin::new(&mut tls).accept().await;
        });

        (addr, handle)
    }

    #[tokio::test]
    async fn legacy_upgrade_connects_where_rustls_is_refused() {
        let (addr, server) = legacy_only_server().await;
        let stream = TcpStream::connect(addr).await.unwrap();

        let (_tls, cert) = super::upgrade(stream, "LEGACY.example.test")
            .await
            .expect("legacy TLS upgrade should succeed against a CBC-only server");

        assert!(ironrdp_tls::extract_tls_server_public_key(&cert).is_some());
        server.abort();
    }

    #[tokio::test]
    async fn strict_upgrade_is_refused_by_the_same_server() {
        let (addr, server) = legacy_only_server().await;
        let stream = TcpStream::connect(addr).await.unwrap();

        // This is the failure reported as "TLS upgrade failed": rustls offers
        // AEAD suites only, so there is nothing to negotiate.
        let error = ironrdp_tls::upgrade(stream, "LEGACY.example.test")
            .await
            .expect_err("rustls should find no shared cipher suite");

        // The fallback only runs for errors this predicate accepts, and the
        // mapping from a refused handshake to an io::ErrorKind is tokio-rustls
        // implementation detail rather than published contract — so pin it.
        assert!(
            crate::commands::rdp::is_handshake_refusal(&error),
            "a refused handshake must be classified as retryable, got {:?}",
            error.kind(),
        );
        server.abort();
    }
}
