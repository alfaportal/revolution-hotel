const { trimEnv } = require("../lib/env");

function isRailwayRestartConfigured() {
  return Boolean(
    trimEnv("RAILWAY_TOKEN") &&
      trimEnv("RAILWAY_SERVICE_ID") &&
      trimEnv("RAILWAY_ENVIRONMENT_ID"),
  );
}

function getRailwayMeta() {
  return {
    configured: isRailwayRestartConfigured(),
    git_commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
    git_branch: process.env.RAILWAY_GIT_BRANCH || null,
    service_id: trimEnv("RAILWAY_SERVICE_ID") || null,
    environment_id: trimEnv("RAILWAY_ENVIRONMENT_ID") || null,
  };
}

async function restartRailwayService() {
  const token = trimEnv("RAILWAY_TOKEN");
  const serviceId = trimEnv("RAILWAY_SERVICE_ID");
  const environmentId = trimEnv("RAILWAY_ENVIRONMENT_ID");

  if (!token || !serviceId || !environmentId) {
    throw new Error(
      "Mungon RAILWAY_TOKEN, RAILWAY_SERVICE_ID ose RAILWAY_ENVIRONMENT_ID në Railway.",
    );
  }

  const res = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
          serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
        }
      `,
      variables: { serviceId, environmentId },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors?.length) {
    const msg = data.errors?.[0]?.message || `Railway API gabim (${res.status})`;
    throw new Error(msg);
  }

  return { ok: true, redeployed: true };
}

module.exports = {
  isRailwayRestartConfigured,
  getRailwayMeta,
  restartRailwayService,
};
