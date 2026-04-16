package au.picosols.promptshield.domain;

public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH;

    public RiskLevel escalateAtLeast(RiskLevel other) {
        return this.ordinal() >= other.ordinal() ? this : other;
    }
}
