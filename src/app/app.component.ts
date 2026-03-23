import { Component, OnInit } from '@angular/core';
import { IonApp, IonRouterOutlet, ModalController } from '@ionic/angular/standalone';
import { AuthService } from './services/auth.service';
import { LineService } from './services/line.service';
import { AuthModalComponent } from './modal/auth-modal/auth-modal.component';
import { ReservationService } from './services/reservation.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  constructor(
    private authService: AuthService,
    private lineService: LineService,
    private modalCtrl: ModalController,
    private reservationService: ReservationService
  ) { }

  async ngOnInit() {
    await this.lineService.initLiff();
    await this.checkAuthStatus();
  }

  private async waitForAuthenticatedUser(maxRetries = 6, delayMs = 300) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const user = await this.authService.getCurrentUser();
      if (user) {
        console.log('[AuthSync] User resolved after login', { attempt, userId: user.id });
        return user;
      }

      console.log('[AuthSync] Waiting for session propagation', { attempt, maxRetries });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    console.warn('[AuthSync] No authenticated user after retries');
    return null;
  }

  private async syncAfterLoginSuccess() {
    console.log('[AuthSync] syncAfterLoginSuccess started');
    const user = await this.waitForAuthenticatedUser();
    if (!user) {
      console.warn('[AuthSync] Aborting sync: user is null');
      return;
    }

    this.isGuestChoice = false;
    this.reservationService.setCurrentProfileId(user.id);
    await this.authService.refreshProfile(user.id);
    await this.authService.getProfile(user.id);
    console.log('[AuthSync] Post-login sync completed', { userId: user.id });
  }

  private async checkAuthStatus() {
    if (this.isGuestChoice) return;

    let user = await this.authService.getCurrentUser();
    if (!user) user = await this.authService.signInAnonymously();

    if (user) {
      this.reservationService.setCurrentProfileId(user.id);
      const profile = await this.authService.getProfile(user.id);
      if (!profile || !profile.line_id) {
        const modal = await this.modalCtrl.create({
          component: AuthModalComponent,
          backdropDismiss: false
        });
        await modal.present();

        const { data } = await modal.onDidDismiss();
        console.log('[AuthSync] Auth modal dismissed from checkAuthStatus', data);
        if (data?.role === 'guest') {
          this.isGuestChoice = true;
        } else if (data?.isLoggedIn) {
          await this.syncAfterLoginSuccess();
        }
      }
    }
  }

  async showAuthLanding() {
    const modal = await this.modalCtrl.create({
      component: AuthModalComponent,
      backdropDismiss: false,
      cssClass: 'auth-full-screen'
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();
    console.log('[AuthSync] Auth modal dismissed from showAuthLanding', data);
    if (data?.isLoggedIn) {
      await this.syncAfterLoginSuccess();
      console.log('User logged in successfully');
    }
  }

  private isGuestChoice = false;


}