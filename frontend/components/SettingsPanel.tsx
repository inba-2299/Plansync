'use client';

import { useState, useEffect, useCallback } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? '';

const MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', desc: 'Fast & cheap (~$0.20/run)', cost: '$' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', desc: 'Balanced (~$0.86/run)', cost: '$$' },
  { id: 'claude-opus-4-5', label: 'Opus 4.5', desc: 'Most capable (expensive)', cost: '$$$' },
];

interface SettingsPanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ sessionId, isOpen, onClose }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load current settings on open
  const loadSettings = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${AGENT_URL}/session/${sessionId}/settings`);
      if (res.ok) {
        const data = await res.json();
        setHasKey(data.hasAnthropicKey ?? false);
        setModel(data.model ?? null);
      }
    } catch {
      // Silently fail — settings are optional
    }
    setLoaded(true);
  }, [sessionId]);

  useEffect(() => {
    if (isOpen && !loaded) loadSettings();
  }, [isOpen, loaded, loadSettings]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (apiKey.trim()) body.anthropicApiKey = apiKey.trim();
      if (model) body.model = model;

      const res = await fetch(`${AGENT_URL}/session/${sessionId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to save settings');
        return;
      }
      setHasKey(data.keySet ?? false);
      setApiKey(''); // Clear after save — don't keep in memory
      setSuccess('Settings saved — takes effect on the next agent turn.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-surface-container-lowest rounded-xl shadow-card-lg border border-outline-variant/30 z-50 animate-fade-in overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-lg">settings</span>
          <span className="font-headline font-bold text-sm text-on-surface">Settings</span>
        </div>
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Anthropic API Key */}
        <div>
          <label htmlFor="anthropic-key" className="block text-xs font-semibold text-on-surface mb-1.5">
            Anthropic API Key
            <span className="text-on-surface-variant font-normal ml-1">(optional)</span>
          </label>
          {hasKey && !apiKey && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-success">
              <span className="material-symbols-outlined text-xs">check_circle</span>
              Your key is set and encrypted
            </div>
          )}
          <input
            id="anthropic-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? 'sk-ant-••••••••••••' : 'sk-ant-api03-...'}
            className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <p className="text-[10px] text-on-surface-variant mt-1">
            {hasKey
              ? 'Enter a new key to replace the existing one. Leave blank to keep current.'
              : 'Bring your own key to use your Anthropic account. If blank, the operator\u2019s key is used.'}
          </p>
        </div>

        {/* Model Selection */}
        <div>
          <label className="block text-xs font-semibold text-on-surface mb-1.5">
            Model
          </label>
          <div className="space-y-1.5">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
                  model === m.id
                    ? 'bg-primary/10 border border-primary/30 ring-1 ring-primary/20'
                    : 'bg-surface-container border border-outline-variant/30 hover:border-primary/20'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-on-surface">{m.label}</div>
                  <div className="text-[10px] text-on-surface-variant">{m.desc}</div>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant shrink-0">{m.cost}</span>
              </button>
            ))}
            {model && (
              <button
                onClick={() => setModel(null)}
                className="text-[10px] text-on-surface-variant hover:text-primary transition-colors"
              >
                Reset to default
              </button>
            )}
          </div>
        </div>

        {/* Error / Success */}
        {error && (
          <div className="text-[11px] text-error bg-error-container/30 border border-error/20 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="text-[11px] text-success bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
            {success}
          </div>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || (!apiKey.trim() && !model)}
          className="w-full text-xs font-semibold px-4 py-2.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        <p className="text-[10px] text-on-surface-variant text-center leading-snug">
          Your API key is encrypted at rest (AES-256-GCM) and never logged or shared. Changes take effect on the next agent turn.
        </p>
      </div>
    </div>
  );
}
