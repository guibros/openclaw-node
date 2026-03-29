/**
 * plan-templates.js — Load, validate, and instantiate plan templates.
 *
 * Templates are YAML files in .openclaw/plan-templates/ that define
 * reusable multi-phase pipelines. Instantiation substitutes context
 * variables and produces a plan ready for mesh.plans.create.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { autoRoutePlan, createPlan } = require('./mesh-plans');

// ── Template Loading ──────────────────────────────

/**
 * Load a single template from a YAML file.
 */
function loadTemplate(templatePath) {
  const content = fs.readFileSync(templatePath, 'utf-8');
  const template = yaml.load(content);

  if (!template.id) {
    template.id = path.basename(templatePath, '.yaml');
  }

  return template;
}

/**
 * List all available templates in a directory.
 * Returns array of { id, name, description, file }.
 */
function listTemplates(templatesDir) {
  if (!fs.existsSync(templatesDir)) return [];

  return fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(file => {
      try {
        const template = loadTemplate(path.join(templatesDir, file));
        return {
          id: template.id,
          name: template.name || template.id,
          description: template.description || '',
          file,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── Template Validation ───────────────────────────

/**
 * Validate a template for structural correctness.
 * Returns { valid: boolean, errors: string[] }.
 */
function validateTemplate(template) {
  const errors = [];

  if (!template.id) errors.push('Missing template id');
  if (!template.phases || !Array.isArray(template.phases)) {
    errors.push('Missing or invalid phases array');
    return { valid: false, errors };
  }

  const allIds = new Set();
  const allSubtasks = [];

  for (let i = 0; i < template.phases.length; i++) {
    const phase = template.phases[i];
    if (!phase.subtasks || !Array.isArray(phase.subtasks)) {
      errors.push(`Phase ${i}: missing subtasks array`);
      continue;
    }

    for (const st of phase.subtasks) {
      if (!st.id) {
        errors.push(`Phase ${i}: subtask missing id`);
        continue;
      }
      if (allIds.has(st.id)) {
        errors.push(`Duplicate subtask id: ${st.id}`);
      }
      allIds.add(st.id);
      allSubtasks.push(st);
    }
  }

  // Check dependency references
  for (const st of allSubtasks) {
    if (st.depends_on) {
      for (const dep of st.depends_on) {
        if (!allIds.has(dep)) {
          errors.push(`Subtask ${st.id}: depends on unknown subtask '${dep}'`);
        }
      }
    }
  }

  // Check for circular dependencies (simple DFS)
  const visiting = new Set();
  const visited = new Set();
  const stMap = new Map(allSubtasks.map(st => [st.id, st]));

  function hasCycle(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const st = stMap.get(id);
    if (st && st.depends_on) {
      for (const dep of st.depends_on) {
        if (hasCycle(dep)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of allIds) {
    if (hasCycle(id)) {
      errors.push(`Circular dependency detected involving subtask '${id}'`);
      break;
    }
  }

  // Validate delegation modes
  const validModes = ['solo_mesh', 'collab_mesh', 'local', 'soul', 'human', 'auto'];
  for (const st of allSubtasks) {
    if (st.delegation && st.delegation.mode && !validModes.includes(st.delegation.mode)) {
      errors.push(`Subtask ${st.id}: invalid delegation mode '${st.delegation.mode}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Template Instantiation ────────────────────────

/**
 * Substitute {{context}} and {{vars.key}} in all string fields.
 */
function substituteVars(obj, context, vars = {}) {
  if (typeof obj === 'string') {
    let result = obj.replace(/\{\{context\}\}/g, context);
    for (const [key, val] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{vars\\.${key}\\}\\}`, 'g'), String(val));
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => substituteVars(item, context, vars));
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = substituteVars(val, context, vars);
    }
    return result;
  }
  return obj;
}

/**
 * Instantiate a template into a plan-ready object.
 *
 * @param {object} template — loaded template
 * @param {string} context — main context string (substituted into {{context}})
 * @param {object} opts — { parent_task_id, vars, planner }
 * @returns {object} — plan object ready for mesh.plans.create
 */
function instantiateTemplate(template, context, opts = {}) {
  const { parent_task_id, vars = {}, planner = 'daedalus' } = opts;

  // Flatten phases into subtask array with dependency wiring
  const subtasks = [];

  for (const phase of template.phases) {
    for (const stSpec of phase.subtasks) {
      const substituted = substituteVars(stSpec, context, vars);

      const subtask = {
        subtask_id: substituted.id,
        title: substituted.title || substituted.id,
        description: substituted.description || '',
        delegation: substituted.delegation || { mode: 'auto' },
        budget_minutes: parseInt(substituted.budget_minutes) || 15,
        metric: substituted.metric || null,
        scope: substituted.scope || [],
        success_criteria: substituted.success_criteria || [],
        depends_on: substituted.depends_on || [],
        critical: substituted.critical || false,
      };

      subtasks.push(subtask);
    }
  }

  // Create the plan
  const plan = createPlan({
    parent_task_id: parent_task_id || `TEMPLATE-${template.id}-${Date.now()}`,
    title: substituteVars(template.name || template.id, context, vars),
    description: substituteVars(template.description || '', context, vars),
    planner,
    failure_policy: template.failure_policy || 'continue_best_effort',
    requires_approval: template.requires_approval !== false, // default true
    subtasks,
  });

  // Auto-route any subtasks with mode: 'auto'
  autoRoutePlan(plan);

  return plan;
}

module.exports = {
  loadTemplate,
  listTemplates,
  validateTemplate,
  instantiateTemplate,
  substituteVars,
};
