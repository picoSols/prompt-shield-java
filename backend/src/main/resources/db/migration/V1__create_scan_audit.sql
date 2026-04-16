CREATE TABLE scan_audit (
    scan_id          VARCHAR(36)   NOT NULL,
    input_hash       VARCHAR(64)   NOT NULL,
    input_length     INT           NOT NULL,
    raw_input        TEXT          NULL,
    risk             VARCHAR(8)    NOT NULL,
    reasons          TEXT          NOT NULL,
    scanner          VARCHAR(16)   NOT NULL,
    ruleset_version  VARCHAR(16)   NOT NULL,
    latency_ms       INT           NOT NULL,
    created_at       TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (scan_id),
    INDEX idx_scan_audit_created_at (created_at),
    INDEX idx_scan_audit_risk (risk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
