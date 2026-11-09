# Contributor contract

Read README.md, docs/moa-architecture.md, docs/architecture.md and CONTRIBUTING.md before changing behavior.

- Use native DSH Agent Loop, sessions, projection, delivery, filesystem permissions and Stop semantics. Do not add a second scheduler or task-specific delegation gates.
- The Coordinator owns notes.md and archived.md. Both roles maintain reusable knowledge through context/index.md (preserve existing legacy index paths) and progressive loading. Role prompts explain goals, responsibilities and operating flow clearly.
- Preserve same-native-turn result consumption and recovery deduplication. An ended Worker turn returns its full final AI message, including an empty body when no AI message was committed.
- Preserve capsule ownership by turn and human-message segment. Do not move old capsules or create new participation on passive reads. Deleted Workers disappear from active MoA views and capsules while native history remains.
- Keep native UI changes narrow. Sidebar extension uses the declared branch seam; ordinary rows, controls and native tabs must remain intact.
- Do not alter native code outside the explicit rc.3 compatibility manifest. Any additional core work needs a separately reviewed contract.
- Use real package types. Add meaningful regression coverage for behavior changes and run build, typecheck, native contracts and package consumer verification. Distinguish scripted tests from real model/UI acceptance.
- Do not commit profiles, credentials, private conversations, session logs, screenshots or local acceptance artifacts.
