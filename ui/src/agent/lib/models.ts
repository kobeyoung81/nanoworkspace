import { deleteJson, fetchJson, postJson, putJson } from './api'

const USER_BASE = '/api/user/v1'
// Paths are relative to the helper's base (ADMIN_API_BASE by default). Using an
// absolute path here would be concatenated onto the base again and 404.
const MODELS = '/models'

export type ModelProvider = {
  id: number
  scope: 'platform' | 'user'
  owner_user_id?: string
  name: string
  kind: string
  base_url: string
  api_key?: string
  created_at?: string
  updated_at?: string
}

export type ModelEntry = {
  id: number
  provider_id: number
  scope: 'platform' | 'user'
  owner_user_id?: string
  name: string
  model: string
  context_window: number
  max_output_tokens: number
  thinking_enabled: boolean
  thinking_effort?: '' | 'low' | 'medium' | 'high'
  params?: string
  created_at?: string
  updated_at?: string
}

export type ModelCatalog = { providers: ModelProvider[]; models: ModelEntry[]; default_model_id?: number }

export type ProviderInput = { name: string; kind?: string; base_url: string; api_key?: string }
export type ModelInput = {
  provider_id: number
  name: string
  model: string
  context_window?: number
  max_output_tokens?: number
  thinking_enabled?: boolean
  thinking_effort?: string
  params?: string
}

// ======== admin (global) ========

export const listAdminModels = () => fetchJson<ModelCatalog>(MODELS)
export const createAdminProvider = (b: ProviderInput) => postJson(`${MODELS}/providers`, b)
export const updateAdminProvider = (id: number, b: ProviderInput) => putJson(`${MODELS}/providers/${id}`, b)
export const deleteAdminProvider = (id: number) => deleteJson(`${MODELS}/providers/${id}`)
export const createAdminModel = (b: ModelInput) => postJson(`${MODELS}/models`, b)
export const updateAdminModel = (id: number, b: ModelInput) => putJson(`${MODELS}/models/${id}`, b)
export const deleteAdminModel = (id: number) => deleteJson(`${MODELS}/models/${id}`)
export const setDefaultModel = (id: number) => postJson(`${MODELS}/default/${id}`, {})

/** Gives one platform model to every built-in agent type (console action).
 *  Fill-only: types that already have a default keep it. */
export type ApplyModelResult = { model_id: number; applied: string[]; already: string[]; defaults: string[] }
export const applyModelToBuiltInTypes = (id: number) =>
  postJson<ApplyModelResult>(`${MODELS}/models/${id}/apply-to-agent-types`, {})

export type FetchedModel = {
  id: string
  context_window?: number
  max_output_tokens?: number
}

export type ModelTestResult = {
  ok: boolean
  latency_ms?: number
  error?: string
  models?: string[]
  model_details?: FetchedModel[]
  reply?: string
}

export type ProviderTestInput = { id?: number; kind?: string; base_url?: string; api_key?: string }
export type ModelTestInput = { id?: number; provider_id?: number; model?: string }

export const testAdminProvider = (body: ProviderTestInput) => postJson<ModelTestResult>(`${MODELS}/providers/test`, body)
export const testAdminModel = (body: ModelTestInput) => postJson<ModelTestResult>(`${MODELS}/test`, body)

// ======== user (own scope) ========

export const listMyModels = () => fetchJson<ModelCatalog>(MODELS, USER_BASE)
export const createMyProvider = (b: ProviderInput) => postJson(`${MODELS}/providers`, b, USER_BASE)
export const updateMyProvider = (id: number, b: ProviderInput) => putJson(`${MODELS}/providers/${id}`, b, USER_BASE)
export const deleteMyProvider = (id: number) => deleteJson(`${MODELS}/providers/${id}`, USER_BASE)
export const createMyModel = (b: ModelInput) => postJson(`${MODELS}/models`, b, USER_BASE)
export const updateMyModel = (id: number, b: ModelInput) => putJson(`${MODELS}/models/${id}`, b, USER_BASE)
export const deleteMyModel = (id: number) => deleteJson(`${MODELS}/models/${id}`, USER_BASE)
export const testMyProvider = (body: ProviderTestInput) => postJson<ModelTestResult>(`${MODELS}/providers/test`, body, USER_BASE)
export const testMyModel = (body: ModelTestInput) => postJson<ModelTestResult>(`${MODELS}/test`, body, USER_BASE)
