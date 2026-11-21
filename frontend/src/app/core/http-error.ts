import { HttpErrorResponse } from '@angular/common/http';

/** Macht aus einem HTTP-Fehler einen Text, den man dem User anzeigen kann. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const detail = (err.error as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (err.status === 0 || err.status >= 500) {
      return 'Der Server ist gerade nicht erreichbar. Läuft das Backend auf Port 8000?';
    }
  }
  return 'Etwas ist schiefgelaufen. Bitte versuche es noch einmal.';
}
