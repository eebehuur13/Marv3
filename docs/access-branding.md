# Cloudflare Access Branding – Marble

Use these reference values to align the Cloudflare Access login experience for your production domain with the in-app Marble visuals. Store them before making changes so we can revert quickly.

## Visual assets
- Logo (preferred): `assets/marble-access-logo.png` (512×512, transparent background).
- Alternate (vector): `assets/marble-access-logo.svg`.
- Favicon-style glyph: reuse the PNG above; it renders crisply down to 128×128.

## Colors
| Element | Hex | Notes |
| --- | --- | --- |
| Background gradient start | `#f8f6ff` | Matches `--color-background-start` in `src/styles/global.scss` |
| Background gradient end | `#eef4ff` | Matches `--color-background-end` |
| Primary accent | `#6056f8` | Same as `--color-accent` |
| Accent hover / CTA focus | `#4f44f0` | Mirrors `--color-accent-hover` |
| Secondary accent | `#ff9f68` | Used in brand mark gradient |
| Heading text | `#111827` | `--color-text-strong` |
| Body text | `#1f2937` | `--color-text-default` |

When Access requires a single primary color, use `#6056f8`. For two-tone gradients, set start `#6056f8` and end `#ff9f68`.

## Copy
- Application name: `Marble`
- Subtitle / description: `Find, connect, and create from every file.`
- Button text: `Continue to Marble`
- Form label: `Work email`
- Footer helper: `Need access? Contact the Marble admin team.`

## Suggested layout tweaks
1. Upload the PNG logo under **Zero Trust → Settings → Appearance**.
2. Set the primary color to `#6056f8` and the background to `#f8f6ff`.
3. Apply the same assets on the specific Access application protecting your production hostname.
4. Review the preview link before publishing.

## Rollback checklist
- Previous application name: `Marv2`
- Previous subtitle: `Get a login code emailed to you`
- Logo: Cloudflare default (none)

If anything looks off after publication, restore the prior name/copy and switch the logo back to default. No code changes are required to revert.
