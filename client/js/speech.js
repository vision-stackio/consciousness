// Thin wrapper around the browser's Web Speech API. Chrome/Edge have solid
// support for both continuous SpeechRecognition and speechSynthesis; Safari
// and Firefox are weaker or missing recognition entirely, so callers should
// treat `SpeechController.supported` as a hard feature check and fall back
// to the text input in the UI when it's false.
export function createSpeechController({ onInterim, onFinal, onListeningChange }) {
    const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
    const supported = !!SpeechRecognitionImpl && !!window.speechSynthesis;
    let recognition = null;
    let listening = false;
    let stoppedByUser = false;
    if (SpeechRecognitionImpl) {
        recognition = new SpeechRecognitionImpl();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
            let interim = "";
            let final = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal)
                    final += transcript;
                else
                    interim += transcript;
            }
            if (interim.trim())
                onInterim?.(interim.trim());
            if (final.trim())
                onFinal?.(final.trim());
        };
        recognition.onerror = (event) => {
            // "no-speech" fires constantly in continuous mode — not a real error.
            if (event.error !== "no-speech")
                console.warn("speech recognition error:", event.error);
        };
        recognition.onend = () => {
            listening = false;
            onListeningChange?.(false);
            // Browsers auto-stop recognition after a period of silence; restart
            // automatically unless the user explicitly turned the mic off.
            if (!stoppedByUser) {
                try {
                    recognition.start();
                    listening = true;
                    onListeningChange?.(true);
                }
                catch {
                    /* already starting — ignore */
                }
            }
        };
    }
    function startListening() {
        if (!recognition || listening)
            return;
        stoppedByUser = false;
        try {
            recognition.start();
            listening = true;
            onListeningChange?.(true);
        }
        catch {
            /* ignore double-start */
        }
    }
    function stopListening() {
        if (!recognition)
            return;
        stoppedByUser = true;
        recognition.stop();
        listening = false;
        onListeningChange?.(false);
    }
    /** @param {string} text @param {{ onEnd?: () => void, rate?: number, pitch?: number }} [opts] */
    function speak(text, { onEnd, rate = 1.02, pitch = 1.05 } = {}) {
        if (!window.speechSynthesis || !text) {
            onEnd?.();
            return;
        }
        window.speechSynthesis.cancel(); // don't stack up overlapping utterances
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.onend = () => onEnd?.();
        utterance.onerror = () => onEnd?.();
        window.speechSynthesis.speak(utterance);
    }
    return {
        supported,
        startListening,
        stopListening,
        speak,
        isListening: () => listening,
    };
}
