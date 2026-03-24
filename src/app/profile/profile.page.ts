import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { UserProfile } from '../data/models';
import { ParkingDataService } from '../services/parking-data.service';
import { GENERAL_SETTINGS, OTHER_SETTINGS } from '../data/app-settings';
import { EditProfileModalComponent } from '../modal/edit-profile-modal/edit-profile-modal.component';
import { InviteVisitorModalComponent } from '../modal/invite-visitor/invite-visitor-modal.component';
import { SwitchMenuModalComponent } from '../components/switch-menu-modal/switch-menu-modal.component';

@Component({
  selector: 'app-profile',
  templateUrl: 'profile.page.html',
  styleUrls: ['profile.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
})
export class ProfilePage implements OnInit {
  userProfile: UserProfile = { name: '', phone: '', avatar: '', role: 'Visitor' };
  generalSettings = GENERAL_SETTINGS;
  otherSettings = OTHER_SETTINGS;

  constructor(
    private parkingService: ParkingDataService,
    private modalCtrl: ModalController
  ) { }

  ngOnInit() {
    this.parkingService.userProfile$.subscribe(p => { if (p) this.userProfile = p; });
  }

  async openEditProfile() {
    const modal = await this.modalCtrl.create({
      component: EditProfileModalComponent,
      componentProps: {
        currentProfile: this.userProfile // Pass the current profile data to pre-fill the form
      },
      breakpoints: [0, 0.55, 1],
      initialBreakpoint: 0.55,
      cssClass: 'edit-profile-modal'
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss();

    if (role === 'confirm' && data) {
      // The auth service has already updated the behavior subject and backend
      // But we can locally merge it into the current view just to be safe
      this.userProfile = { ...this.userProfile, ...data };
    }
  }

  async openSwitchMenu() {
    const modal = await this.modalCtrl.create({
      component: SwitchMenuModalComponent,
      componentProps: { currentProfile: this.userProfile },
      breakpoints: [0, 0.55],
      initialBreakpoint: 0.55,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data && this.userProfile.id) {
      // รีโหลด profile หลัง switch สำเร็จ
      this.parkingService.loadUserProfile(this.userProfile.id);
    }
  }

  async openInviteModal() {
    const modal = await this.modalCtrl.create({
      component: InviteVisitorModalComponent,
      breakpoints: [0, 0.75, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {
      console.log('Invite created:', data);
    }
  }
}



