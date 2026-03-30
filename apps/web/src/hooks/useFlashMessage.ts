import { createElement, useCallback, useEffect, useRef, useState } from "react";

/** Краткое сообщение об успехе без сторонних toast. */
export function useFlashMessage(durationMs = 2500) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMessage(text);
      timerRef.current = setTimeout(() => {
        setMessage(null);
        timerRef.current = null;
      }, durationMs);
    },
    [durationMs]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const banner =
    message != null
      ? createElement(
          "div",
          {
            role: "status",
            className:
              "rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-800",
          },
          message
        )
      : null;

  return { show, banner };
}
