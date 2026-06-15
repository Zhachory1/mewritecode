---
id: risk-cave-always-on
goldModel: gpt-4.1
promptVersion: prose-gold-v1
questionB64: V2hhdCBhcmUgdGhlIHJpc2tzIG9mIHJ1bm5pbmcgY2F2ZS1tb2RlICh0ZXJzZS1wcm9zZSBzdHlsaW5nKSBhbHdheXMtb24gaW4gcHJvZHVjdGlvbiBmb3IgYSBjb2RpbmcgYWdlbnQ/IEVudW1lcmF0ZSB0aGUgZmFpbHVyZSBtb2RlcyBhbmQgd2hvIHRoZXkgaHVydC4=
---
- Loss of critical context: Terse-prose styling may omit necessary qualifiers, caveats, or edge-case details, leading to incomplete or misleading information in agent outputs.
- Increased ambiguity: Shortened responses can introduce ambiguity, making it harder for users or downstream systems to interpret intent, requirements, or constraints.
- Reduced error transparency: Important warnings, error explanations, or troubleshooting steps may be omitted, making debugging and incident response slower and riskier.
- Missed compliance or safety requirements: Legal, security, or operational caveats may be dropped, increasing the risk of non-compliance or unsafe actions.
- Poor onboarding and knowledge transfer: New users or maintainers may lack sufficient context to understand decisions, code, or system behavior, leading to onboarding friction and operational mistakes.
- User frustration: Users may feel unsupported or confused by overly terse responses, reducing trust and satisfaction.
- Downstream automation failures: Integrations or automated consumers relying on full context may malfunction or make unsafe decisions due to missing information.
- Disproportionate harm to less-experienced users: Novices or non-experts are more likely to misinterpret terse outputs, increasing their risk of error.
- Amplified risk in high-stakes or regulated environments: In domains requiring exhaustive documentation or traceability, terse outputs can cause compliance failures or safety incidents.
- Cumulative knowledge erosion: Over time, persistent omission of detail can degrade institutional knowledge, making future maintenance and audits more difficult.
