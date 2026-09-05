import { useCallback, useEffect, useRef, useState } from "react";

export function useAsync<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const nextData = await load();
      if (mounted.current && generation === requestGeneration.current)
        setData(nextData);
    } catch (caught) {
      if (mounted.current && generation === requestGeneration.current) {
        setError(
          caught instanceof Error ? caught.message : "The request failed",
        );
      }
    } finally {
      if (mounted.current && generation === requestGeneration.current)
        setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);
  return { data, error, loading, reload, setData };
}
