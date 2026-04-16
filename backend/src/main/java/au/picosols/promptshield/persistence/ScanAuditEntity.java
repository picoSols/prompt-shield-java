package au.picosols.promptshield.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "scan_audit")
public class ScanAuditEntity {

    @Id
    @Column(name = "scan_id", length = 36, nullable = false)
    private String scanId;

    @Column(name = "input_hash", length = 64, nullable = false)
    private String inputHash;

    @Column(name = "input_length", nullable = false)
    private Integer inputLength;

    @Column(name = "raw_input", columnDefinition = "TEXT")
    private String rawInput;

    @Column(name = "risk", length = 8, nullable = false)
    private String risk;

    @Column(name = "reasons", columnDefinition = "TEXT", nullable = false)
    private String reasonsJson;

    @Column(name = "scanner", length = 16, nullable = false)
    private String scanner;

    @Column(name = "ruleset_version", length = 16, nullable = false)
    private String rulesetVersion;

    @Column(name = "latency_ms", nullable = false)
    private Integer latencyMs;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public String getScanId() { return scanId; }
    public void setScanId(String scanId) { this.scanId = scanId; }
    public String getInputHash() { return inputHash; }
    public void setInputHash(String inputHash) { this.inputHash = inputHash; }
    public Integer getInputLength() { return inputLength; }
    public void setInputLength(Integer inputLength) { this.inputLength = inputLength; }
    public String getRawInput() { return rawInput; }
    public void setRawInput(String rawInput) { this.rawInput = rawInput; }
    public String getRisk() { return risk; }
    public void setRisk(String risk) { this.risk = risk; }
    public String getReasonsJson() { return reasonsJson; }
    public void setReasonsJson(String reasonsJson) { this.reasonsJson = reasonsJson; }
    public String getScanner() { return scanner; }
    public void setScanner(String scanner) { this.scanner = scanner; }
    public String getRulesetVersion() { return rulesetVersion; }
    public void setRulesetVersion(String rulesetVersion) { this.rulesetVersion = rulesetVersion; }
    public Integer getLatencyMs() { return latencyMs; }
    public void setLatencyMs(Integer latencyMs) { this.latencyMs = latencyMs; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
