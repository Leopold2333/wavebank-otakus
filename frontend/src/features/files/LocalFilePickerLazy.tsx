import { lazy } from 'react';

export const LocalFilePicker = lazy(() =>
  import('./LocalFilePicker').then((module) => ({ default: module.LocalFilePicker })),
);
