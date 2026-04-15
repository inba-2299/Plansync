'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import { ApiKeyCard } from './ApiKeyCard';

interface ApprovalOption {
  label: string;
  value: string;
  description?: string;
}

interface ApprovalPromptProps {
  question: string;
  options: ApprovalOption[];
  context: string | null;
  answered: boolean;
  selectedLabel?: string;
  onSelect: (option: ApprovalOption) => void;
  // For special handling when the agent asks for an API key:
  sessionId: string;
  toolUseId: string;
  onApiKeySubmit: (apiKey: string) => void;
}

/**
 * ApprovalPrompt — agent-emitted prompt for HITL decisions.
 *
 * The ONLY blocking interaction in the chat. The agent calls
 * `request_user_approval` and the loop pauses until the user clicks an
 * option (which POSTs back as a uiAction).
 *
 * Special case: if the question is about the API key and one of the
 * options has value="enter_key" or similar, we render an inline
 * ApiKeyCard instead of the chip list. This is a UX detail — typing
 * an API key is different from picking a yes/no.
 */
export function ApprovalPrompt({
  question,
  options,
  context,
  answered,
  selectedLabel,
  onSelect,
  onApiKeySubmit,
}: ApprovalPromptProps) {
  // Detect API key request: question mentions key + has only one option to "enter"
  const isApiKeyRequest =
    /api\s*key/i.test(question) &&
    options.some((o) => /enter|submit|paste|provide/i.test(o.label));

  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  if (isApiKeyRequest && !answered) {
    if (showApiKeyInput) {
      return (
        <ApiKeyCard
          onSubmit={async (apiKey) => {
            await onApiKeySubmit(apiKey);
          }}
        />
      );
    }
    // Show "click to enter" preamble first
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface-container-lowest border border-primary/30 rounded-3xl shadow-card overflow-hidden"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-primary text-base">
                key
              </span>
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-primary mb-0.5">
                Agent needs input
              </div>
              <div className="font-headline font-bold text-on-surface text-base">
                {question}
              </div>
              {context && (
                <div className="text-xs text-on-surface-variant mt-1">{context}</div>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowApiKeyInput(true)}
            className={cn(
              'w-full py-3 bg-gradient-to-r from-primary to-primary-container text-white',
              'font-headline font-bold text-sm rounded-xl shadow-card-sm',
              'hover:scale-[1.01] active:scale-[0.99] transition-all',
              'flex items-center justify-center gap-2'
            )}
          >
            <span className="material-symbols-outlined text-base">key</span>
            Enter API Key
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-surface-container-lowest rounded-3xl shadow-card overflow-hidden',
        answered ? 'border border-success/30' : 'border border-primary/30'
      )}
    >
      <div className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
              answered ? 'bg-success/10' : 'bg-primary/10'
            )}
          >
            <span
              className={cn(
                'material-symbols-outlined text-base',
                answered ? 'text-success' : 'text-primary'
              )}
            >
              {answered ? 'check_circle' : 'help'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={cn(
                'text-[10px] uppercase tracking-widest font-bold mb-0.5',
                answered ? 'text-success' : 'text-primary'
              )}
            >
              {answered ? 'Answered' : 'Agent needs your input'}
            </div>
            <div className="font-headline font-bold text-on-surface text-base">
              {question}
            </div>
            {context && (
              <div className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                {context}
              </div>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {!answered ? (
            <motion.div
              key="options"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
              {options.map((option, idx) => {
                const isPrimary =
                  idx === 0 ||
                  /approve|proceed|confirm|yes|ok|continue/i.test(option.label);
                return (
                  <motion.button
                    key={option.value}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * idx }}
                    onClick={() => onSelect(option)}
                    className={cn(
                      'group relative px-4 py-3 rounded-xl text-left transition-all',
                      'hover:scale-[1.01] active:scale-[0.99]',
                      isPrimary
                        ? 'bg-gradient-to-br from-primary to-primary-container text-white shadow-card-sm hover:shadow-card'
                        : 'bg-surface-container-low text-on-surface border border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div
                          className={cn(
                            'font-headline font-bold text-sm',
                            isPrimary ? 'text-white' : 'text-on-surface'
                          )}
                        >
                          {option.label}
                        </div>
                        {option.description && (
                          <div
                            className={cn(
                              'text-[11px] mt-0.5',
                              isPrimary ? 'text-white/80' : 'text-on-surface-variant'
                            )}
                          >
                            {option.description}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'material-symbols-outlined text-base flex-shrink-0',
                          isPrimary ? 'text-white' : 'text-on-surface-variant'
                        )}
                      >
                        arrow_forward
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="answered"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/5 border border-success/20"
            >
              <span className="material-symbols-outlined text-success text-base">
                done_all
              </span>
              <span className="text-sm text-on-surface">
                You selected:{' '}
                <strong className="font-bold text-on-surface">{selectedLabel}</strong>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
