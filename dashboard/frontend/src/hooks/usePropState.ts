'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Local state that resets when `prop` changes, without a sync-in-effect.
 * See https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
export function usePropState<T>(prop: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(prop);
  const [prev, setPrev] = useState(prop);
  if (!Object.is(prop, prev)) {
    setPrev(prop);
    setState(prop);
  }
  return [state, setState];
}
