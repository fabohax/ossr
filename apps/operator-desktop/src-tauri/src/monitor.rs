use chrono::{DateTime, Utc};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};
use url::Url;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EndpointHealth {
    pub reachable: bool,
    pub status_code: Option<u16>,
    pub latency_ms: Option<u64>,
    pub state: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelaySummary {
    pub live: EndpointHealth,
    pub ready: EndpointHealth,
    pub relay_id: Option<String>,
    pub network: Option<String>,
    pub sponsor_principal: Option<String>,
    pub sponsor_balance_micro_stx: Option<String>,
    pub minimum_balance_micro_stx: Option<String>,
    pub quotes_enabled: Option<bool>,
    pub sponsorships_enabled: Option<bool>,
    pub uptime_seconds: Option<u64>,
    pub requests_total: Option<u64>,
    pub broadcasts: Option<u64>,
    pub confirmations: Option<u64>,
    pub rejections: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub health: EndpointHealth,
    pub fully_synced: Option<bool>,
    pub stacks_tip_height: Option<u64>,
    pub burn_block_height: Option<u64>,
    pub stable_burn_block_height: Option<u64>,
    pub tenure_height: Option<u64>,
    pub server_version: Option<String>,
    pub reference_tip_height: Option<u64>,
    pub blocks_behind: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub checked_at: DateTime<Utc>,
    pub overall: String,
    pub relay: RelaySummary,
    pub node: NodeSummary,
}

#[derive(Clone)]
pub struct Monitor {
    client: Client,
}

impl Default for Monitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Monitor {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent("ossr-operator-desktop/0.1")
            .build()
            .expect("static HTTP client configuration must be valid");
        Self { client }
    }

    pub async fn snapshot(
        &self,
        relay_base: &str,
        node_base: &str,
        reference_base: Option<&str>,
    ) -> Result<DashboardSnapshot, String> {
        let relay = validated_base_url(relay_base)?;
        let node = validated_base_url(node_base)?;
        let reference = reference_base.map(validated_base_url).transpose()?;

        let (live, ready, info, metrics, node_info, reference_info) = tokio::join!(
            self.get(relay.join("health/live").map_err(stringify)?),
            self.get(relay.join("health/ready").map_err(stringify)?),
            self.get(relay.join("v1/info").map_err(stringify)?),
            self.get(relay.join("v1/metrics").map_err(stringify)?),
            self.get(node.join("v2/info").map_err(stringify)?),
            self.get_optional(
                reference
                    .map(|url| url.join("v2/info").map_err(stringify))
                    .transpose()?
            ),
        );

        let live_health = endpoint_health(&live, "ok", "offline");
        let ready_health = endpoint_health(&ready, "ready", "not ready");
        let node_health = endpoint_health(&node_info, "online", "offline");
        let local_tip = value_u64(&node_info.body, "stacks_tip_height");
        let reference_tip = value_u64(&reference_info.body, "stacks_tip_height");
        let blocks_behind = match (local_tip, reference_tip) {
            (Some(local), Some(remote)) => Some(remote.saturating_sub(local)),
            _ => None,
        };
        let fully_synced = value_bool(&node_info.body, "is_fully_synced");
        let overall = if live.ok && ready.ok && node_info.ok && fully_synced == Some(true) {
            "healthy"
        } else if live.ok || node_info.ok {
            "degraded"
        } else {
            "offline"
        };

        Ok(DashboardSnapshot {
            checked_at: Utc::now(),
            overall: overall.into(),
            relay: RelaySummary {
                live: live_health,
                ready: ready_health,
                relay_id: value_string(&info.body, "relayId"),
                network: value_string(&info.body, "network"),
                sponsor_principal: value_string(&info.body, "sponsorPrincipal"),
                sponsor_balance_micro_stx: nested_string(
                    &ready.body,
                    &["operator", "balanceMicroStx"],
                ),
                minimum_balance_micro_stx: nested_string(
                    &ready.body,
                    &["operator", "minimumBalanceMicroStx"],
                ),
                quotes_enabled: value_bool(&info.body, "quotesEnabled"),
                sponsorships_enabled: value_bool(&info.body, "sponsorshipsEnabled"),
                uptime_seconds: value_u64(&metrics.body, "uptimeSeconds"),
                requests_total: nested_u64(&metrics.body, &["requests", "total"]),
                broadcasts: nested_u64(&metrics.body, &["sponsorships", "broadcasts"]),
                confirmations: nested_u64(&metrics.body, &["sponsorships", "confirmations"]),
                rejections: nested_u64(&metrics.body, &["sponsorships", "rejections"]),
            },
            node: NodeSummary {
                health: node_health,
                fully_synced,
                stacks_tip_height: local_tip,
                burn_block_height: value_u64(&node_info.body, "burn_block_height"),
                stable_burn_block_height: value_u64(&node_info.body, "stable_burn_block_height"),
                tenure_height: value_u64(&node_info.body, "tenure_height"),
                server_version: value_string(&node_info.body, "server_version"),
                reference_tip_height: reference_tip,
                blocks_behind,
            },
        })
    }

    async fn get(&self, url: Url) -> FetchResult {
        let started = Instant::now();
        match self.client.get(url).send().await {
            Ok(response) => {
                let status = response.status();
                let body = response.json::<Value>().await.unwrap_or(Value::Null);
                FetchResult {
                    ok: status.is_success(),
                    status: Some(status),
                    latency_ms: Some(started.elapsed().as_millis() as u64),
                    body,
                    error: None,
                }
            }
            Err(error) => FetchResult {
                ok: false,
                status: error.status(),
                latency_ms: Some(started.elapsed().as_millis() as u64),
                body: Value::Null,
                error: Some(if error.is_timeout() {
                    "request timed out".into()
                } else {
                    error.to_string()
                }),
            },
        }
    }

    async fn get_optional(&self, url: Option<Url>) -> FetchResult {
        match url {
            Some(url) => self.get(url).await,
            None => FetchResult::empty(),
        }
    }
}

struct FetchResult {
    ok: bool,
    status: Option<StatusCode>,
    latency_ms: Option<u64>,
    body: Value,
    error: Option<String>,
}

impl FetchResult {
    fn empty() -> Self {
        Self {
            ok: false,
            status: None,
            latency_ms: None,
            body: Value::Null,
            error: None,
        }
    }
}

fn endpoint_health(result: &FetchResult, up: &str, down: &str) -> EndpointHealth {
    EndpointHealth {
        reachable: result.ok,
        status_code: result.status.map(|status| status.as_u16()),
        latency_ms: result.latency_ms,
        state: if result.ok { up } else { down }.into(),
        detail: result.error.clone().or_else(|| {
            (!result.ok).then(|| {
                result
                    .body
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("endpoint returned an error")
                    .to_owned()
            })
        }),
    }
}

fn validated_base_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw).map_err(|_| format!("Invalid endpoint URL: {raw}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("Endpoint must be an http(s) URL: {raw}"));
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(ToOwned::to_owned)
}

fn value_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key)?.as_bool()
}

fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key)?.as_u64()
}

fn nested_string(value: &Value, path: &[&str]) -> Option<String> {
    path.iter()
        .try_fold(value, |current, key| current.get(key))?
        .as_str()
        .map(ToOwned::to_owned)
}

fn nested_u64(value: &Value, path: &[&str]) -> Option<u64> {
    path.iter()
        .try_fold(value, |current, key| current.get(key))?
        .as_u64()
}

fn stringify(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_gets_a_trailing_slash() {
        assert_eq!(
            validated_base_url("http://127.0.0.1:3002")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:3002/"
        );
    }

    #[test]
    fn rejects_non_http_endpoint() {
        assert!(validated_base_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn nested_values_are_optional() {
        let value = serde_json::json!({"operator": {"balanceMicroStx": "42"}});
        assert_eq!(
            nested_string(&value, &["operator", "balanceMicroStx"]),
            Some("42".into())
        );
        assert_eq!(nested_u64(&value, &["operator", "missing"]), None);
    }
}
