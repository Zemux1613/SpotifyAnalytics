import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, tap } from 'rxjs';
import { UserProfile } from '../../core/models';

/**
 * Hält den Login-Zustand. Die eigentliche Session liegt als HttpOnly-Cookie im Browser,
 * das Frontend kann sie nicht lesen und fragt stattdessen /api/me, ob sie noch gilt.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly user = signal<UserProfile | null>(null);

  /** Liefert das Profil des eingeloggten Users oder null, wenn keine gültige Session besteht. */
  loadUser(): Observable<UserProfile | null> {
    const current = this.user();
    if (current) {
      return of(current);
    }
    return this.http.get<UserProfile>('/api/me').pipe(
      tap((user) => this.user.set(user)),
      catchError(() => of(null)),
    );
  }

  /** Geht per Browser-Navigation zu Spotify, danach landet der User wieder im Frontend. */
  login(): void {
    window.location.href = '/api/login';
  }

  logout(): void {
    this.http
      .post('/api/logout', {})
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.user.set(null);
        void this.router.navigateByUrl('/login');
      });
  }

  /** Wird aufgerufen, wenn das Backend 401 meldet (Session abgelaufen). */
  clear(): void {
    this.user.set(null);
  }
}
