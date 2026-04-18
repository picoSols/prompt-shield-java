package au.picosols.promptshield.scan;

import au.picosols.promptshield.domain.RiskLevel;
import au.picosols.promptshield.domain.ShieldReason;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Deterministic pattern-based scanner. Intentionally small and explainable.
 * Ported from the Python `prompt_shield` module; each rule corresponds to a
 * documented injection family.
 *
 * Inputs are preprocessed through {@link InputNormalizer} (NFKC-casefold,
 * zero-width/bidi strip, Unicode-confusable skeleton, leet-fold) before the
 * keyword rules run. UNICODE_OBFUSCATION alone inspects the raw input so it
 * can still flag the hidden characters that normalization would erase.
 */
@Component
public class RuleEngine {

    public static final String VERSION = "1.1.0";

    private record Rule(String code, RiskLevel risk, Pattern pattern) {
        ShieldReason match(String input) {
            var m = pattern.matcher(input);
            if (m.find()) {
                String excerpt = m.group().trim();
                if (excerpt.length() > 80) excerpt = excerpt.substring(0, 80) + "…";
                return new ShieldReason(code, "Match: '" + excerpt + "'");
            }
            return null;
        }
    }

    // Zero-width / bidi override detector — runs against the raw input.
    private static final Pattern UNICODE_OBFUSCATION =
            Pattern.compile("[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064]");

    // All other rules run against the normalized form.
    // Trigger stems are extended with common multilingual roots (e.g. German
    // "ignoriere", Spanish/Portuguese/Italian "ignora", French "ignorez") via
    // the `ignor\w*` match, so non-English attacks don't silently pass LOW.
    private static final List<Rule> NORMALIZED_RULES = List.of(
            // Instruction override — classic "ignore previous" family + multilingual
            new Rule("INSTRUCTION_OVERRIDE", RiskLevel.HIGH,
                    Pattern.compile(
                            "(?i)\\b(ignor\\w*|disregard\\w*|forget|override|set[-\\s]aside|bypass)\\b"
                          + "[^.!?]{0,40}"
                          + "\\b(previous|prior|above|earlier|all|any|alle|vorherig\\w*|antérieur\\w*|anteriore\\w*)\\b"
                          + "[^.!?]{0,40}"
                          + "\\b(instruction\\w*|prompt\\w*|rule\\w*|directive\\w*|message\\w*|"
                          + "anweisung\\w*|regel\\w*|anordnung\\w*)\\b")),

            // System-prompt exfiltration + semantic rewords ("tell me what you were told")
            new Rule("PROMPT_EXFILTRATION", RiskLevel.HIGH,
                    Pattern.compile(
                            "(?i)\\b(reveal|print|show|output|repeat|tell\\s+me|what\\s+(were|was)\\s+you)\\b"
                          + "[^.!?]{0,60}"
                          + "\\b(system|initial|hidden|secret|your|original|first|told|said|start\\w*|beginning)\\b"
                          + "[^.!?]{0,60}"
                          + "\\b(prompt\\w*|instruction\\w*|message\\w*|rule\\w*|told|said|system)\\b")),

            // Role reassignment / jailbreak personas
            new Rule("ROLE_REASSIGNMENT", RiskLevel.HIGH,
                    Pattern.compile(
                            "(?i)\\b(you\\s+are\\s+(now|no\\s+longer)|act\\s+as|pretend\\s+(to\\s+be|you\\s+are)|"
                          + "from\\s+now\\s+on\\s+you|roleplay\\s+as|simulate\\s+(being|a)|"
                          + "imagine\\s+you\\s+are)\\b")),

            // Well-known jailbreak names
            new Rule("JAILBREAK_KEYWORD", RiskLevel.HIGH,
                    Pattern.compile("(?i)\\b(dan|do\\s+anything\\s+now|developer\\s+mode|jailbreak|grandma\\s+mode)\\b")),

            // Chat/role delimiter injection (model-format tokens)
            new Rule("DELIMITER_INJECTION", RiskLevel.HIGH,
                    Pattern.compile(
                            "(<\\|(im_start|im_end|endoftext|system|user|assistant)\\|>"
                          + "|\\[INST\\]|\\[/INST\\]|</s>|<\\|end_of_text\\|>)")),

            // Encoded payload hints (keyword + action)
            new Rule("ENCODED_PAYLOAD", RiskLevel.MEDIUM,
                    Pattern.compile(
                            "(?i)\\b(base64|hex|rot13|url-?encoded?)\\b[^.!?]{0,30}"
                          + "\\b(decode|run|execute|eval|follow|apply)\\b")),

            // Base64-looking blob adjacent to an action verb
            new Rule("ENCODED_PAYLOAD", RiskLevel.MEDIUM,
                    Pattern.compile(
                            "(?i)\\b(decode|execute|run|eval|follow|apply)\\b[^.!?]{0,40}"
                          + "[A-Za-z0-9+/]{24,}={0,2}")),

            // Excessive instruction-word density (heuristic) — BOUNDED quantifiers only
            // Replaces the previous nested-lazy pattern that had catastrophic backtracking.
            new Rule("INSTRUCTION_DENSITY", RiskLevel.LOW,
                    Pattern.compile(
                            "(?i)\\b(now|immediately|stop|always|never|must)\\b"
                          + "(\\s+\\S+){1,20}?\\s+\\b(you|your)\\b"
                          + "(\\s+\\S+){1,20}?\\s+\\b(you|your)\\b"))
    );

    public Report evaluate(String input) {
        if (input == null) input = "";

        List<ShieldReason> hits = new ArrayList<>();
        RiskLevel top = RiskLevel.LOW;

        // UNICODE_OBFUSCATION runs against the raw input — the whole point is
        // that normalization would hide the attack.
        var unicodeMatcher = UNICODE_OBFUSCATION.matcher(input);
        if (unicodeMatcher.find()) {
            hits.add(new ShieldReason("UNICODE_OBFUSCATION",
                    "Zero-width or bidi control character detected"));
            top = top.escalateAtLeast(RiskLevel.MEDIUM);
        }

        // Keyword rules run against both the normalized form and a leet-folded
        // variant, so e.g. `base64 decode` matches ENCODED_PAYLOAD (from the
        // normalized pass) AND `1gn0re prev10us` matches INSTRUCTION_OVERRIDE
        // (from the leet-folded pass). Dedupe by rule code so one attack
        // doesn't produce two identical reason rows.
        String normalized = InputNormalizer.normalize(input);
        String leetFolded = InputNormalizer.leetFold(normalized);
        Set<String> seenCodes = new HashSet<>();
        for (String form : new String[]{normalized, leetFolded}) {
            for (var rule : NORMALIZED_RULES) {
                if (seenCodes.contains(rule.code())) continue;
                var hit = rule.match(form);
                if (hit != null) {
                    hits.add(hit);
                    seenCodes.add(rule.code());
                    top = top.escalateAtLeast(rule.risk());
                }
            }
        }

        return new Report(top, List.copyOf(hits));
    }

    public record Report(RiskLevel risk, List<ShieldReason> reasons) {}
}
