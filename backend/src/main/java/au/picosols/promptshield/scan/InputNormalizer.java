package au.picosols.promptshield.scan;

import com.ibm.icu.text.Normalizer2;

import java.util.Map;

/**
 * Preprocesses untrusted input before rule-matching so common evasion tricks
 * don't walk straight through the regex layer.
 *
 * Two shapes are produced:
 *   1. {@link #normalize(String)} — NFKC + case-fold + zero-width/bidi strip
 *      + homoglyph map. Use this as the default matching form.
 *   2. {@link #leetFold(String)} — applies a small digit→letter substitution
 *      to digits that sit next to Latin letters (so `1gn0re` collapses to
 *      `ignore` but `base64` stays `base64`). Rules that need to catch
 *      lazy leetspeak should also be run against this form.
 *
 * We deliberately avoid ICU's {@code SpoofChecker.getSkeleton} — its
 * "confusable skeleton" transforms Latin multigraphs (e.g. rn→m) in ways
 * that break keyword matching against the produced string.
 */
public final class InputNormalizer {

    private static final Normalizer2 NFKC_CF = Normalizer2.getNFKCCasefoldInstance();

    /**
     * Single-codepoint homoglyph fold: non-Latin letters that look like a
     * Latin letter map onto that letter. Populated for Cyrillic and Greek,
     * which account for essentially all real-world homoglyph attacks on
     * English text. NFKC has already case-folded by the time this runs,
     * so lowercase entries are enough.
     */
    private static final Map<Integer, Character> HOMOGLYPHS = Map.ofEntries(
            // Cyrillic
            Map.entry(0x0430, 'a'),  // а
            Map.entry(0x0435, 'e'),  // е
            Map.entry(0x043E, 'o'),  // о
            Map.entry(0x0441, 'c'),  // с
            Map.entry(0x0440, 'p'),  // р
            Map.entry(0x0445, 'x'),  // х
            Map.entry(0x0443, 'y'),  // у
            Map.entry(0x0456, 'i'),  // і (Ukrainian i)
            Map.entry(0x0458, 'j'),  // ј (Macedonian je)
            Map.entry(0x04CF, 'l'),  // ӏ
            Map.entry(0x0455, 's'),  // ѕ
            Map.entry(0x0432, 'b'),  // в
            Map.entry(0x043D, 'h'),  // н

            // Greek
            Map.entry(0x03B1, 'a'),  // α
            Map.entry(0x03BF, 'o'),  // ο
            Map.entry(0x03C1, 'p'),  // ρ
            Map.entry(0x03BD, 'v'),  // ν
            Map.entry(0x03B5, 'e'),  // ε
            Map.entry(0x03C4, 't'),  // τ
            Map.entry(0x03B3, 'y'),  // γ
            Map.entry(0x03BC, 'u'),  // μ
            Map.entry(0x03B9, 'i'),  // ι
            Map.entry(0x03BA, 'k')   // κ
    );

    private InputNormalizer() {}

    public static String normalize(String input) {
        if (input == null || input.isEmpty()) return "";
        String stripped = stripInvisibles(input);
        String nfkc = NFKC_CF.normalize(stripped);
        return foldHomoglyphs(nfkc);
    }

    /**
     * Fold digits that sit next to a Latin letter back onto their visual
     * letter counterparts. Conservative: digits inside a run of two or more
     * digits (e.g. `64` in `base64`) are left alone.
     */
    public static String leetFold(String s) {
        if (s == null || s.isEmpty()) return "";
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (shouldLeetFold(s, i, c)) {
                out.append(leetOf(c));
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    private static boolean shouldLeetFold(String s, int i, char c) {
        char folded = leetOf(c);
        if (folded == c) return false;
        char prev = i > 0 ? s.charAt(i - 1) : '\0';
        char next = i + 1 < s.length() ? s.charAt(i + 1) : '\0';
        // Don't fold if inside a run of digits.
        if (Character.isDigit(prev) || Character.isDigit(next)) return false;
        // Only fold if at least one neighbour is a Latin letter.
        return isLatinLetter(prev) || isLatinLetter(next);
    }

    private static char leetOf(char c) {
        return switch (c) {
            case '0' -> 'o';
            case '1' -> 'i';
            case '3' -> 'e';
            case '4' -> 'a';
            case '5' -> 's';
            case '7' -> 't';
            case '@' -> 'a';
            case '$' -> 's';
            default  -> c;
        };
    }

    private static boolean isLatinLetter(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    private static String stripInvisibles(String s) {
        StringBuilder out = new StringBuilder(s.length());
        s.codePoints().forEach(cp -> {
            boolean drop = (cp >= 0x200B && cp <= 0x200F)
                        || (cp >= 0x202A && cp <= 0x202E)
                        || (cp >= 0x2060 && cp <= 0x2064)
                        || (cp >= 0x2066 && cp <= 0x2069)
                        || cp == 0xFEFF;
            if (!drop) out.appendCodePoint(cp);
        });
        return out.toString();
    }

    private static String foldHomoglyphs(String s) {
        StringBuilder out = new StringBuilder(s.length());
        s.codePoints().forEach(cp -> {
            Character mapped = HOMOGLYPHS.get(cp);
            if (mapped != null) out.append(mapped.charValue());
            else out.appendCodePoint(cp);
        });
        return out.toString();
    }
}
