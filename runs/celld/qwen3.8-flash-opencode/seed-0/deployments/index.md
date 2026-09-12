# Files

- [Deployment pipeline and generations](deploy-and-rollout.md) - celld deploy builds a Wrangler project with esbuild and publishes content-addressed objects plus a current.json pointer to the fleet bucket; nodes poll the pointer, build a new Generation beside the serving one, switch atomically, and migrate resident cells at safe points with a forced swap after CELLD_DEPLOY_MAX_AGE_S.
