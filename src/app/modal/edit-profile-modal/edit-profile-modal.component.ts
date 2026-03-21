import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { LoadingController, ModalController, ToastController } from '@ionic/angular/standalone';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-edit-profile-modal',
  templateUrl: './edit-profile-modal.component.html',
  styleUrls: ['./edit-profile-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, ReactiveFormsModule]
})
export class EditProfileModalComponent implements OnInit {
  @Input() currentProfile: any; // Passed from parent page

  profileForm: FormGroup;

  constructor(
    private modalCtrl: ModalController,
    private fb: FormBuilder,
    private authService: AuthService,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController
  ) {
    this.profileForm = this.fb.group({
      phone: ['', [Validators.required, Validators.pattern('^[0-9]{9,10}$')]],
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit() {
    if (this.currentProfile) {
      this.profileForm.patchValue({
        phone: this.currentProfile.phone || '',
        email: this.currentProfile.email || ''
      });
    }
  }

  cancel() {
    this.modalCtrl.dismiss();
  }

  async save() {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.showToast('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง', 'danger');
      return;
    }

    const updateData = this.profileForm.value;
    const loading = await this.loadingCtrl.create({ message: 'กำลังบันทึกข้อมูล...' });
    await loading.present();

    try {
      const user = await this.authService.getCurrentUser();
      if (!user) throw new Error('ผู้ใช้งานไม่ได้เข้าสู่ระบบ');

      // Note: We use user.id because the auth user ID is identical to the profile ID
      await this.authService.updateProfilev2(user.id, updateData);

      await this.showToast('บันทึกข้อมูลเรียบร้อยแล้ว', 'success');
      this.modalCtrl.dismiss(updateData, 'confirm');
    } catch (error: any) {
      await this.showToast('เกิดข้อผิดพลาด: ' + error.message, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async showToast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
      position: 'top'
    });
    toast.present();
  }
}
