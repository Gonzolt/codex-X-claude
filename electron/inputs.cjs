const Ajv = require('ajv');
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });

function validateInput(schema, content) {
  const validate = ajv.compile(schema || { type: 'object', properties: {} });
  if (!validate(content)) throw new Error(ajv.errorsText(validate.errors, { separator: '\n' }));
  return content;
}

// Only a consent-shaped form can be answered by session auto-approval.
// Preferences, choices, account sign-ins, and free-text questions still need input.
function automaticConsent(input) {
  if (input.kind !== 'form' || input.autoEligible === false) return null;
  const properties = input.schema?.properties || {};
  const entries = Object.entries(properties);
  if (entries.some(([name, field]) => field.type !== 'boolean' || !/^(confirm|confirmed|allow|approve|approved|proceed|consent)$/i.test(name))) return null;
  const answer = Object.fromEntries(entries.map(([name]) => [name, true]));
  try { return validateInput(input.schema, answer); } catch { return null; }
}

function questionSchema(questions) {
  return {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(questions.map((question, index) => [question.id || String(index), {
      type: 'string', title: question.question || question.header || 'Your answer',
      ...(question.options?.length ? { enum: question.options.map(option => option.label) } : { minLength: 1 })
    }])),
    required: questions.map((question, index) => question.id || String(index))
  };
}

module.exports = { validateInput, automaticConsent, questionSchema };
