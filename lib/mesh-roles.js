/**
 * mesh-roles.js — Shared role->component mapping for the OpenClaw mesh.
 * Must match nodeFilter values in the mesh-deploy manifest.
 */
const ROLE_COMPONENTS = {
  lead: ['mesh-daemons', 'mesh-cli', 'shared-lib', 'mc', 'memory-daemon',
         'memory-harness', 'souls', 'skills', 'boot', 'workspace-docs',
         'gateway', 'companion-bridge', 'service-defs'],
  worker: ['mesh-daemons', 'mesh-cli', 'shared-lib', 'souls', 'skills',
           'workspace-docs', 'service-defs'],
};

module.exports = { ROLE_COMPONENTS };
