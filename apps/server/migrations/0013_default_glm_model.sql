-- The previous GPT defaults return an empty completion through the current
-- ixicai router. Move existing automatic workspace defaults to the verified
-- GLM model while leaving deliberately selected non-default models untouched.
update workspace_settings
set default_model = 'glm-5.2'
where default_model in ('gpt-4.1', 'gpt-5.4', 'gpt-5.4-mini', 'dofe:gpt-5.4', 'dofe:gpt-5.4-mini');

alter table workspace_settings
  alter column default_model set default 'glm-5.2';
