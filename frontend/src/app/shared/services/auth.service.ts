import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, tap } from 'rxjs';
import { AuthApi, MeApi, UserProfileDto } from '../../api/generated';

/**
 * Hält den Login-Zustand. Die eigentliche Session liegt als HttpOnly-Cookie im Browser,
 * das Frontend kann sie nicht lesen und fragt stattdessen /api/me, ob sie noch gilt.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly authApi = inject(AuthApi);
  private readonly meApi = inject(MeApi);
  private readonly router = inject(Router);

  readonly user = signal<UserProfileDto | null>(null);

  /** Liefert das Profil des eingeloggten Users oder null, wenn keine gültige Session besteht. */
  loadUser(): Observable<UserProfileDto | null> {
    const current = this.user();
    if (current) {
      return of(current);
    }
    return this.meApi.getProfileMeGet().pipe(
      tap((user) => this.user.set(user)),
      catchError(() => of(null)),
    );
  }

  /** Geht per Browser-Navigation zu Spotify, danach landet der User wieder im Frontend. */
  login(): void {
    window.location.href = '/api/login';
  }

  logout(): void {
    this.authApi.logoutLogoutPost()
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
