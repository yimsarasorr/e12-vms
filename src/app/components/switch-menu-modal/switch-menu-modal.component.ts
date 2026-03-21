import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ModalController } from '@ionic/angular/standalone';
import { SupabaseService } from '../../services/supabase.service';
import { UserProfile } from '../../data/models';

interface RoleOption {
  level: number;
  role: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-switch-menu-modal',
  templateUrl: './switch-menu-modal.component.html',
  styleUrls: ['./switch-menu-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class SwitchMenuModalComponent implements OnInit {
  @Input() currentProfile: UserProfile | null = null;

  isLoading = false;
  activeLevel: number = -1;

  roles: RoleOption[] = [
    { level: 0, role: 'Guest',   label: 'Guest',   description: 'ผู้เยี่ยมชมทั่วไป',        icon: 'person-outline',       color: '#9ca3af' },
    { level: 1, role: 'Visitor', label: 'Visitor',  description: 'ผู้เข้าติดต่อที่ยืนยันตัวตนแล้ว',      icon: 'walk-outline',         color: '#f59e0b' },
    { level: 2, role: 'User',    label: 'User',     description: 'สมาชิกทั่วไปของระบบ',                   icon: 'people-outline',       color: '#3b82f6' },
    { level: 3, role: 'Host',    label: 'Host',     description: 'บุคลากรที่มีสิทธิ์จัดการ',         icon: 'business-outline',     color: '#10b981' },
  ];

  constructor(
    private modalCtrl: ModalController,
    private supabaseService: SupabaseService
  ) {}

  ngOnInit() {
    const currentRole = this.currentProfile?.role?.toLowerCase() ?? 'guest';
    const matched = this.roles.find(r => r.role.toLowerCase() === currentRole);
    this.activeLevel = matched?.level ?? 0;
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }

  async switchRole(option: RoleOption) {
    if (this.isLoading || option.level === this.activeLevel) return;

    this.isLoading = true;
    try {
      const userId = this.currentProfile?.id ?? (await this.supabaseService.client.auth.getUser()).data.user?.id;
      if (!userId) throw new Error('No user ID');

      const { error } = await this.supabaseService.client.functions.invoke('switch-menu', {
        body: {
          user_id: userId,
          role: option.role,
          role_level: option.level
        }
      });

      if (error) throw error;

      this.activeLevel = option.level;
      this.modalCtrl.dismiss({ role: option.role, role_level: option.level }, 'confirm');
    } catch (err: any) {
      console.error('[SwitchMenu] Error:', err.message);
    } finally {
      this.isLoading = false;
    }
  }
}
