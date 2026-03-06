'use client';

/**
 * i18n/LanguageContext.js — React context for language state.
 *
 * Provides:
 *   - lang: current language code
 *   - setLang: change language
 *   - t(key): get translated string
 *   - dir: 'ltr' | 'rtl'
 *   - isRTL: boolean
 *   - voiceLang: language instruction for Gemini voice
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { LANGUAGES, DEFAULT_LANG, getTranslator } from './locales';

const LanguageContext = createContext(null);

const STORAGE_KEY = 'ai_tutor_lang';

export function LanguageProvider({ children }) {
    const [lang, setLangState] = useState(DEFAULT_LANG);

    // Read from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && LANGUAGES[saved]) {
            setLangState(saved);
        }
    }, []);

    const setLang = useCallback((code) => {
        if (!LANGUAGES[code]) return;
        setLangState(code);
        localStorage.setItem(STORAGE_KEY, code);
    }, []);

    const t = useCallback((key) => {
        return getTranslator(lang)(key);
    }, [lang]);

    const meta = LANGUAGES[lang] || LANGUAGES[DEFAULT_LANG];

    // Update <html> dir and lang attributes
    useEffect(() => {
        document.documentElement.dir = meta.dir;
        document.documentElement.lang = lang.startsWith('ar') ? 'ar' : lang;
    }, [lang, meta.dir]);

    return (
        <LanguageContext.Provider value={{
            lang,
            setLang,
            t,
            dir: meta.dir,
            isRTL: meta.dir === 'rtl',
            voiceLang: meta.voiceLang,
        }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const ctx = useContext(LanguageContext);
    if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
    return ctx;
}
