package au.picosols.promptshield.domain;

import java.util.List;
import java.util.UUID;

public record ScanResult(
        UUID scanId,
        RiskLevel risk,
        List<ShieldReason> reasons,
        String rulesetVersion,
        String scanner,
        long latencyMs
) {}
