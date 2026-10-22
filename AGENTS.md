# Contribution workflow

- Use the local `dev` branch as the primary branch for ongoing work.
- Commit each completed, coherent change on `dev`; prefer focused commits over a stream of redundant follow-up commits.
- Do not merge into `main`. The user performs that merge.
- Do not rebase or rewrite commit history unless the user asks. When asked to prepare a merge, reorganize related commits on `dev` relative to `main` (for example, squash repeated commits for the same feature or fix), then stop without merging.
- Add `Co-Authored-By: codex <codex@openai.com>` to commits authored with Codex.
