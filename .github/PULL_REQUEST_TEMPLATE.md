## 🧵 Context Fabric Pull Request

### Goal Description
Describe the problem being solved or the feature being added.

### 🛡 Verification Checklist
All items must be [x] checked before review. PRs failing these checks will be closed.

- [ ] **Build Check**: `npm run build` passes with zero errors.
- [ ] **Lint Check**: `npm run lint` passes with no errors/warnings.
- [ ] **Security Check**: PR does NOT bypass `PathGuard` for file operations.
- [ ] **Verification Check**: CADRE pipeline verified manually (drift, router, governor).
- [ ] **Protocol Check**: Imports use `.js` extension (ESM strictly enforced).

### Design Decisions
Briefly explain any structural or logic decisions made.

### Manual Proof
Paste a screenshot or terminal log proving the change works as intended.
