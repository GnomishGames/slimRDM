//! Claude session journal → Obsidian.
//!
//! Ingests Claude Code's own JSONL transcripts (`~/.claude/projects/<dir>/<uuid>.jsonl`)
//! and renders readable per-session markdown notes into the vault, linking each into the
//! shared daily index. SlimRDM only ingests and structures; Obsidian summarizes/searches.

use chrono::{DateTime, Local};
use serde_json::Value;

/// One rendered turn of a Claude conversation.
#[derive(Debug, Clone, PartialEq)]
pub enum Turn {
    User(String),
    Assistant(String),
    Tool { name: String, summary: String },
}

/// A parsed Claude Code session ready to render.
#[derive(Debug, Clone)]
pub struct ClaudeSession {
    pub session_id: String,
    pub project: String,
    pub cwd: String,
    pub git_branch: Option<String>,
    pub model: Option<String>,
    pub start: DateTime<Local>,
    pub end: DateTime<Local>,
    pub turns: Vec<Turn>,
}

/// Last path component of a cwd (handles both `\` and `/`), used as the project name.
fn project_name(cwd: &str) -> String {
    cwd.replace('\\', "/")
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(cwd)
        .to_string()
}

/// Compact one-line summary of a tool_use block: prefer the salient input field.
fn tool_summary(input: &Value) -> String {
    let pick = ["command", "file_path", "path", "pattern", "url", "query"]
        .iter()
        .find_map(|k| input.get(*k).and_then(|v| v.as_str()));
    let s = pick.unwrap_or("").trim();
    let s = s.replace('\n', " ");
    if s.chars().count() > 100 {
        format!("{}…", s.chars().take(100).collect::<String>())
    } else {
        s
    }
}

fn parse_ts(v: &Value) -> Option<DateTime<Local>> {
    v.get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Local))
}

/// Parse a Claude Code JSONL transcript into an ordered session. Returns `None` when the
/// transcript has no renderable turns. Malformed lines and sidechain/metadata events are
/// skipped individually.
pub fn parse_session(jsonl: &str) -> Option<ClaudeSession> {
    let mut turns: Vec<Turn> = Vec::new();
    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut model: Option<String> = None;
    let mut start: Option<DateTime<Local>> = None;
    let mut end: Option<DateTime<Local>> = None;

    for line in jsonl.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let obj: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if obj.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Capture session-level metadata from any event that carries it.
        if session_id.is_none() {
            if let Some(s) = obj.get("sessionId").and_then(|v| v.as_str()) {
                session_id = Some(s.to_string());
            }
        }
        if let Some(c) = obj.get("cwd").and_then(|v| v.as_str()) {
            cwd = Some(c.to_string());
        }
        if let Some(b) = obj.get("gitBranch").and_then(|v| v.as_str()) {
            if !b.is_empty() {
                git_branch = Some(b.to_string());
            }
        }

        let ty = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match ty {
            "user" => {
                // A string content is a real prompt; a list is a tool_result turn → skip.
                if let Some(text) = obj
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                {
                    let t = text.trim();
                    if !t.is_empty() {
                        turns.push(Turn::User(t.to_string()));
                        if let Some(ts) = parse_ts(&obj) {
                            start.get_or_insert(ts);
                            end = Some(ts);
                        }
                    }
                }
            }
            "assistant" => {
                if let Some(m) = obj.get("message") {
                    if let Some(md) = m.get("model").and_then(|v| v.as_str()) {
                        if md != "<synthetic>" && model.is_none() {
                            model = Some(md.to_string());
                        }
                    }
                    if let Some(blocks) = m.get("content").and_then(|c| c.as_array()) {
                        for b in blocks {
                            match b.get("type").and_then(|v| v.as_str()) {
                                Some("text") => {
                                    if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                                        let t = t.trim();
                                        if !t.is_empty() {
                                            turns.push(Turn::Assistant(t.to_string()));
                                        }
                                    }
                                }
                                Some("tool_use") => {
                                    let name = b
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("tool")
                                        .to_string();
                                    let summary = b
                                        .get("input")
                                        .map(tool_summary)
                                        .unwrap_or_default();
                                    turns.push(Turn::Tool { name, summary });
                                }
                                _ => {} // thinking and others skipped
                            }
                        }
                    }
                }
                if let Some(ts) = parse_ts(&obj) {
                    start.get_or_insert(ts);
                    end = Some(ts);
                }
            }
            _ => {} // metadata events skipped
        }
    }

    if turns.is_empty() {
        return None;
    }
    let cwd = cwd.unwrap_or_default();
    let now = Local::now();
    Some(ClaudeSession {
        session_id: session_id.unwrap_or_else(|| "unknown".to_string()),
        project: project_name(&cwd),
        cwd,
        git_branch,
        model,
        start: start.unwrap_or(now),
        end: end.unwrap_or(now),
        turns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
{"type":"user","sessionId":"abc123def456","cwd":"C:\\apps\\SlimRdm","gitBranch":"main","timestamp":"2026-06-25T01:01:55.545Z","message":{"role":"user","content":"How do I run tests?"}}
{"type":"assistant","sessionId":"abc123def456","timestamp":"2026-06-25T01:02:07.868Z","message":{"model":"claude-opus-4-8","content":[{"type":"thinking","thinking":"secret internal"},{"type":"text","text":"Run cargo test."},{"type":"tool_use","name":"Bash","input":{"command":"cargo test --lib"}}]}}
{"type":"user","sessionId":"abc123def456","timestamp":"2026-06-25T01:02:10Z","message":{"content":[{"type":"tool_result","content":"ok"}]}}
{"type":"mode","mode":"x","sessionId":"abc123def456"}
{"isSidechain":true,"type":"assistant","timestamp":"2026-06-25T01:03:00Z","message":{"model":"x","content":[{"type":"text","text":"sidechain noise"}]}}
{"type":"assistant","sessionId":"abc123def456","timestamp":"2026-06-25T01:04:00Z","message":{"model":"<synthetic>","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"src/main.rs"}}]}}
"#;

    #[test]
    fn parses_turns_in_order_skipping_noise() {
        let s = parse_session(FIXTURE).unwrap();
        assert_eq!(s.session_id, "abc123def456");
        assert_eq!(s.project, "SlimRdm");
        assert_eq!(s.git_branch.as_deref(), Some("main"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-4-8"));
        assert_eq!(
            s.turns,
            vec![
                Turn::User("How do I run tests?".into()),
                Turn::Assistant("Run cargo test.".into()),
                Turn::Tool { name: "Bash".into(), summary: "cargo test --lib".into() },
                Turn::Tool { name: "Edit".into(), summary: "src/main.rs".into() },
            ]
        );
    }

    #[test]
    fn empty_transcript_is_none() {
        assert!(parse_session("").is_none());
        assert!(parse_session(r#"{"type":"mode","mode":"x"}"#).is_none());
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let s = parse_session("not json\n{\"type\":\"user\",\"message\":{\"content\":\"hi\"}}").unwrap();
        assert_eq!(s.turns, vec![Turn::User("hi".into())]);
    }
}
