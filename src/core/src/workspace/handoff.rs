//! Short-lived handoff codes for attaching an external agent session to a
//! workspace thread.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use rand::rngs::OsRng;
use rand::Rng;

struct HandoffEntry {
    agent_kind: String,
    session_id: String,
    cwd: String,
    expires_at: Instant,
}

static HANDOFF_CODES: LazyLock<Mutex<HashMap<String, HandoffEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const TTL: Duration = Duration::from_secs(120);
const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

fn generate_code() -> String {
    let mut rng = OsRng;
    (0..4)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

pub fn store(agent_kind: String, session_id: String, cwd: String) -> String {
    let mut map = HANDOFF_CODES.lock();
    let now = Instant::now();
    map.retain(|_, entry| entry.expires_at > now);

    let code = loop {
        let candidate = generate_code();
        if !map.contains_key(&candidate) {
            break candidate;
        }
    };
    map.insert(
        code.clone(),
        HandoffEntry {
            agent_kind,
            session_id,
            cwd,
            expires_at: now + TTL,
        },
    );
    code
}

pub fn consume(code: &str) -> Option<(String, String, String)> {
    let mut map = HANDOFF_CODES.lock();
    let now = Instant::now();
    map.retain(|_, entry| entry.expires_at > now);
    let entry = map.remove(&code.to_uppercase())?;
    Some((entry.agent_kind, entry.session_id, entry.cwd))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_code_is_four_chars_from_alphabet() {
        for _ in 0..100 {
            let code = generate_code();
            assert_eq!(code.len(), 4);
            for byte in code.bytes() {
                assert!(CHARSET.contains(&byte), "char {byte:?} not in alphabet");
            }
        }
    }

    #[test]
    fn store_and_consume_roundtrip() {
        let code = store("claude".into(), "sess-1".into(), "/tmp".into());
        let (agent, session, cwd) = consume(&code).expect("code should resolve");
        assert_eq!(agent, "claude");
        assert_eq!(session, "sess-1");
        assert_eq!(cwd, "/tmp");
    }

    #[test]
    fn consume_is_one_shot() {
        let code = store("gemini".into(), "sess-2".into(), "/home".into());
        assert!(consume(&code).is_some());
        assert!(consume(&code).is_none(), "second consume must fail");
    }
}
