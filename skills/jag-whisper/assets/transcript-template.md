# Artifact Shape

The assembler serializes metadata safely rather than interpolating this illustrative template. Headings are English; the optional summary and recognized text retain the selected/source languages.

```text
---
processing_date: "YYYY-MM-DD"
transcript_source: "input.json"
language: "detected-language-or-null"
summary_coverage: "none|complete|partial"
---

# Recording Transcript

Machine-generated recognition; may contain errors. Not a verified record of speech.

## Summary

Optional authorized summary. Omit this section in transcript-only mode.

## Full Transcript

The original JSON text is inside a code fence longer than every backtick run in the text.
```

No recording date, model, duration, speaker or certainty is inferred from absent metadata. Raw JSON remains separate; readable artifact formatting must not paraphrase its recognized text.
