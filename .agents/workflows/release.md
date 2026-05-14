# Workflow: Release Process

Step-by-step procedure for releasing new versions.

## Prerequisites

- [ ] All features for release are merged to main
- [ ] CI/CD pipeline is green
- [ ] No critical bugs in staging

## Step 1: Pre-Release Checks

### Code Quality

```bash
# Run full verification
bun run typecheck
bun run lint
bun run test
bun run build
```

### Environment Check

- [ ] All required env vars documented in `.env.example`
- [ ] No hardcoded secrets in codebase
- [ ] Convex schema migrations are backward compatible

### Dependency Check

```bash
# Check for security vulnerabilities
bun audit

# Check for outdated packages (optional)
bun outdated
```

## Step 2: Version Bump

### Determine Version Type

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking changes | Major | 1.0.0 → 2.0.0 |
| New features | Minor | 1.0.0 → 1.1.0 |
| Bug fixes | Patch | 1.0.0 → 1.0.1 |

### Update Version

```bash
# Update package.json version
# Update any version references
```

## Step 3: Changelog

### Update CHANGELOG.md (if exists)

```markdown
## [x.x.x] - YYYY-MM-DD

### Added
- Feature description

### Changed
- Change description

### Fixed
- Bug fix description

### Security
- Security fix description
```

## Step 4: Create Release Commit

```bash
git add .
git commit -m "chore: release vX.X.X"
```

## Step 5: Tag Release

```bash
git tag -a vX.X.X -m "Release vX.X.X"
git push origin main --tags
```

## Step 6: Deploy

### Vercel (Automatic)

- Push to main triggers deployment
- Monitor deployment in Vercel dashboard
- Verify production URL works

### Convex

- Schema changes deploy automatically with `npx convex deploy`
- Verify functions in Convex dashboard

## Step 7: Post-Release

### Verify Production

- [ ] App loads correctly
- [ ] Auth works
- [ ] Chat functionality works
- [ ] No console errors

### Monitor

- [ ] Check error tracking (if configured)
- [ ] Monitor Vercel analytics
- [ ] Watch for user reports

### Announce (if applicable)

- Update documentation
- Notify users of changes
- Post release notes

## Rollback Procedure

If critical issues found:

### Vercel Rollback

1. Go to Vercel dashboard
2. Find previous deployment
3. Click "Promote to Production"

### Convex Rollback

- Schema changes may need manual reversion
- Functions can be reverted via git revert + redeploy

### Git Rollback

```bash
# Revert the release commit
git revert HEAD
git push origin main

# Or reset (destructive, use carefully)
git reset --hard HEAD~1
git push -f origin main  # Requires approval
```

## Troubleshooting

### Build fails in CI

- Check CI logs for specific error
- Verify all dependencies are installed
- Check for env var issues

### Deployment succeeds but app broken

- Check Vercel function logs
- Verify environment variables set correctly
- Check Convex deployment status

### Type errors in production build

- Run `bun run build` locally first
- Check for dynamic imports missing
- Verify all exports are correct

## Reference

- `.github/workflows/ci-cd.yml` — CI/CD configuration
- `vercel.json` — Vercel configuration
- `.agents/project/README.md` — Deployment and validation pointers
