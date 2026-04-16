package au.picosols.promptshield.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ScanRequest(
        @NotBlank @Size(max = 50_000) String input,
        String scanner // "rules" | "llm" | "hybrid" — optional, default "rules"
) {}
