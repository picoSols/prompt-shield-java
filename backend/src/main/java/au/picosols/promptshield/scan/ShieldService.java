package au.picosols.promptshield.scan;

import au.picosols.promptshield.domain.RiskLevel;
import au.picosols.promptshield.domain.ScanResult;
import au.picosols.promptshield.domain.ShieldReason;
import au.picosols.promptshield.persistence.ScanAuditEntity;
import au.picosols.promptshield.persistence.ScanAuditRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Service
public class ShieldService {

    private static final Logger log = LoggerFactory.getLogger(ShieldService.class);

    private final RuleEngine ruleEngine;
    private final LlmJudge llmJudge;
    private final ScanAuditRepository audit;
    private final ObjectMapper mapper;
    private final boolean storeRaw;

    public ShieldService(
            RuleEngine ruleEngine,
            LlmJudge llmJudge,
            ScanAuditRepository audit,
            ObjectMapper mapper,
            @Value("${shield.audit.store-raw:false}") boolean storeRaw
    ) {
        this.ruleEngine = ruleEngine;
        this.llmJudge = llmJudge;
        this.audit = audit;
        this.mapper = mapper;
        this.storeRaw = storeRaw;
    }

    public ScanResult scan(String input, String scannerChoice) {
        long start = System.nanoTime();
        String scanner = normalize(scannerChoice);

        RiskLevel risk = RiskLevel.LOW;
        List<ShieldReason> reasons = new ArrayList<>();

        // Rules always run: they're fast and free.
        var ruleReport = ruleEngine.evaluate(input);
        risk = risk.escalateAtLeast(ruleReport.risk());
        reasons.addAll(ruleReport.reasons());

        // Only call the LLM judge if the caller opted in AND we didn't already short-circuit
        // on a rule-confirmed HIGH (saves tokens + latency on the obvious stuff).
        boolean shouldEscalate = (scanner.equals("llm") || scanner.equals("hybrid"))
                && !(scanner.equals("hybrid") && risk == RiskLevel.HIGH);
        if (shouldEscalate) {
            var verdict = llmJudge.evaluate(input);
            risk = risk.escalateAtLeast(verdict.risk());
            reasons.addAll(verdict.reasons());
        }

        if (reasons.isEmpty()) {
            reasons.add(new ShieldReason("BENIGN", "No patterns matched"));
        }

        UUID scanId = UUID.randomUUID();
        long latencyMs = (System.nanoTime() - start) / 1_000_000;

        persistAudit(scanId, input, risk, reasons, scanner, latencyMs);

        return new ScanResult(
                scanId,
                risk,
                List.copyOf(reasons),
                RuleEngine.VERSION,
                scanner,
                latencyMs);
    }

    private String normalize(String choice) {
        if (choice == null) return "rules";
        String s = choice.trim().toLowerCase();
        return switch (s) {
            case "llm", "hybrid", "rules" -> s;
            default -> "rules";
        };
    }

    private void persistAudit(UUID scanId, String input, RiskLevel risk,
                              List<ShieldReason> reasons, String scanner, long latencyMs) {
        try {
            var entity = new ScanAuditEntity();
            entity.setScanId(scanId.toString());
            entity.setInputHash(sha256(input));
            entity.setInputLength(input.length());
            entity.setRawInput(storeRaw ? input : null);
            entity.setRisk(risk.name());
            entity.setReasonsJson(mapper.writeValueAsString(reasons));
            entity.setScanner(scanner);
            entity.setRulesetVersion(RuleEngine.VERSION);
            entity.setLatencyMs((int) latencyMs);
            entity.setCreatedAt(Instant.now());
            audit.save(entity);
        } catch (JsonProcessingException ex) {
            // Audit write must never break the main request path, but silent
            // failures hide real problems — log so an operator can notice.
            log.warn("Failed to serialise scan reasons for audit log (scanId={}): {}",
                    scanId, ex.getMessage());
        } catch (RuntimeException ex) {
            log.warn("Failed to persist audit row (scanId={}): {}", scanId, ex.getMessage());
        }
    }

    private static String sha256(String s) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            return "";
        }
    }
}
