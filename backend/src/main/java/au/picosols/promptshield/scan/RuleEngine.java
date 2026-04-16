package au.picosols.promptshield.scan;

import au.picosols.promptshield.domain.RiskLevel;
import au.picosols.promptshield.domain.ShieldReason;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Deterministic pattern-based scanner. Intentionally small and explainable.
 * Ported from the Python `prompt_shield` module; each rule corresponds to a
 * documented injection family.
 */
@Component
public class RuleEngine {

    public static final String VERSION = "1.0.0";

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

    private static final List<Rule> RULES = List.of(
            // Instruction override — the classic "ignore previous" family
            new Rule("INSTRUCTION_OVERRIDE", RiskLevel.HIGH,
                    Pattern.compile(
                            "(?i)\\b(ignore|disregard|forget|override)\\b[^.!?]{0,40}"
                          + "\\b(previous|prior|above|earlier|all|any)\\b[^.!?]{0,40}"
                          + "\\b(instruction|prompt|rule|directive|message)s?\\b")),

            // System-prompt exfiltration
            new Rule("PROMPT_EXFILTRATION", RiskLevel.HIGH,
                    Pattern.compile(
                            "(?i)\\b(reveal|print|show|output|repeat|tell me)\\b[^.!?]{0,40}"
                          + "\\b(system|initial|hidden|secret|your)\\b[^.!?]{0,40}"
                          + "\\b(prompt|instruction|message|rule)s?\\b")),

            // Role reassignment / jailbreak personas
            new Rule("ROLE_REASSIGNMENT", RiskLevel.HIGH,
                    Pattern.compile(
                            "(?i)\\b(you are (now|no longer)|act as|pretend (to be|you are)|"
                          + "from now on you|roleplay as)\\b")),

            // Well-known jailbreak names
            new Rule("JAILBREAK_KEYWORD", RiskLevel.HIGH,
                    Pattern.compile("(?i)\\b(DAN|do anything now|developer mode|jailbreak)\\b")),

            // Chat/role delimiter injection (model-format tokens)
            new Rule("DELIMITER_INJECTION", RiskLevel.HIGH,
                    Pattern.compile(
                            "(<\\|(im_start|im_end|endoftext|system|user|assistant)\\|>"
                          + "|\\[INST\\]|\\[/INST\\]|</s>|<\\|end_of_text\\|>)")),

            // Encoded payload hints
            new Rule("ENCODED_PAYLOAD", RiskLevel.MEDIUM,
                    Pattern.compile(
                            "(?i)\\b(base64|hex|rot13|url-?encoded?)\\b[^.!?]{0,30}"
                          + "\\b(decode|run|execute|eval)\\b")),

            // Zero-width / bidi override chars (obfuscation)
            new Rule("UNICODE_OBFUSCATION", RiskLevel.MEDIUM,
                    Pattern.compile("[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064]")),

            // Excessive instruction-word density (heuristic)
            new Rule("INSTRUCTION_DENSITY", RiskLevel.LOW,
                    Pattern.compile(
                            "(?i)(^|\\s)(now|immediately|stop|always|never|must)"
                          + "([^.!?]+?\\b(you|your)\\b){2,}"))
    );

    public Report evaluate(String input) {
        List<ShieldReason> hits = new ArrayList<>();
        RiskLevel top = RiskLevel.LOW;
        for (var rule : RULES) {
            var hit = rule.match(input);
            if (hit != null) {
                hits.add(hit);
                top = top.escalateAtLeast(rule.risk());
            }
        }
        return new Report(top, List.copyOf(hits));
    }

    public record Report(RiskLevel risk, List<ShieldReason> reasons) {}
}
