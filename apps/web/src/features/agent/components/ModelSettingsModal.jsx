import { useState, useEffect } from 'react';
import { X, Settings, Zap, CheckCircle2, AlertCircle, Loader2, Key, Globe, Cpu } from 'lucide-react';
import { getLlmSettings, saveLlmSettings, testLlmConnectivity } from '../../../api/agent-api.js';

const PROVIDER_OPTIONS = [
  { value: 'glm', label: '智谱 GLM (glm-4-flash / glm-4-plus)' },
  { value: 'deepseek', label: 'DeepSeek (deepseek-chat / deepseek-reasoner)' },
  { value: 'minimax', label: 'MiniMax (abab6.5s-chat)' },
  { value: 'openai', label: 'OpenAI / 自定义 OpenAI 兼容' }
];

/**
 * @file ModelSettingsModal.jsx
 * @description 动态 LLM 模型配置与连通性探针模态框 (对接 PR-08 settings-manager)
 */
export function ModelSettingsModal({ isOpen, onClose, onSettingsUpdated }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, latencyMs, error }

  const [form, setForm] = useState({
    provider: 'glm',
    model: 'glm-4-flash',
    apiBase: '',
    apiKey: '',
    temperature: 0.1,
    maskedApiKey: ''
  });

  useEffect(() => {
    if (!isOpen) {
      setTestResult(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    getLlmSettings()
      .then((data) => {
        if (!isMounted) return;
        setForm({
          provider: data.provider || 'glm',
          model: data.model || 'glm-4-flash',
          apiBase: data.apiBase || '',
          apiKey: '',
          maskedApiKey: data.maskedApiKey || '',
          temperature: data.temperature ?? 0.1
        });
      })
      .catch((err) => {
        console.error('加载模型配置失败', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = {
        provider: form.provider,
        model: form.model,
        apiBase: form.apiBase || undefined,
        apiKey: form.apiKey || undefined
      };
      const res = await testLlmConnectivity(payload);
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        provider: form.provider,
        model: form.model,
        apiBase: form.apiBase || undefined,
        temperature: Number(form.temperature)
      };
      if (form.apiKey.trim()) {
        payload.apiKey = form.apiKey.trim();
      }
      const updated = await saveLlmSettings(payload);
      onSettingsUpdated?.(updated);
      onClose();
    } catch (err) {
      setTestResult({ ok: false, error: `保存失败: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl text-slate-200">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-sky-400" />
            <h3 className="font-medium text-sm text-white">动态 LLM 模型配置</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <Loader2 size={24} className="animate-spin text-sky-400" />
            <span className="text-xs">加载运行时配置...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                模型服务商 (Provider)
              </label>
              <div className="relative">
                <select
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-hidden"
                >
                  {PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                模型名称 (Model)
              </label>
              <div className="flex items-center gap-2">
                <Cpu size={14} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="如 glm-4-flash 或 deepseek-chat"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-hidden"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                API Base URL (可选覆盖)
              </label>
              <div className="flex items-center gap-2">
                <Globe size={14} className="text-slate-400 shrink-0" />
                <input
                  type="url"
                  value={form.apiBase}
                  onChange={(e) => setForm({ ...form, apiBase: e.target.value })}
                  placeholder="留空则使用默认端点"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  API Key
                </label>
                {form.maskedApiKey && (
                  <span className="text-[10px] text-slate-400">
                    当前已配置: <code className="text-emerald-400">{form.maskedApiKey}</code>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Key size={14} className="text-slate-400 shrink-0" />
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={form.maskedApiKey ? '留空保持现有密钥，输入新值覆盖' : '请输入 API Key'}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-hidden"
                />
              </div>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-md text-xs flex items-center justify-between border ${
                  testResult.ok
                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800'
                    : 'bg-rose-950/40 text-rose-300 border-rose-800'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {testResult.ok ? (
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle size={14} className="text-rose-400 shrink-0" />
                  )}
                  <span className="truncate">
                    {testResult.ok
                      ? `连通性测试通过 (${testResult.latencyMs || 0}ms)`
                      : testResult.error || '连通性测试失败'}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={testing || saving}
                onClick={handleTest}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer transition-colors disabled:opacity-50"
              >
                {testing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>探测中...</span>
                  </>
                ) : (
                  <>
                    <Zap size={13} className="text-amber-400" />
                    <span>测试连通性</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white cursor-pointer transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>保存中...</span>
                    </>
                  ) : (
                    <span>保存配置</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
