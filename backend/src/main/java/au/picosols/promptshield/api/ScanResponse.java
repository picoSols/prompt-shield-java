package au.picosols.promptshield.api;

import au.picosols.promptshield.domain.RiskLevel;
import au.picosols.promptshield.domain.ScanResult;
import au.picosols.promptshield.domain.ShieldReason;

import java.util.List;
import java.util.UUID;

public record ScanResponse(
        UUID scanId,
        RiskLevel risk,
        List<ShieldReason> reasons,
        String rulesetVersion,
        String scanner,
        long latencyMs
) {
    public static ScanResponse from(ScanResult r) {
        return new ScanResponse(
                r.scanId(),
                r.risk(),
                r.reasons(),
                r.rulesetVersion(),
                r.scanner(),
                r.latencyMs()
        );
    }
}
