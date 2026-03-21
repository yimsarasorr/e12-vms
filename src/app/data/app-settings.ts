import { SettingItem } from './models';

export const GENERAL_SETTINGS: SettingItem[] = [
  { title: 'เปลี่ยนรหัสผ่าน', icon: 'lock-closed-outline' },
  { title: 'ตั้งค่าการแจ้งเตือน', icon: 'notifications-outline' },
  { title: 'ภาษา', icon: 'language-outline' },
];

export const OTHER_SETTINGS: SettingItem[] = [
  { title: 'เกี่ยวกับเรา', icon: 'information-circle-outline' },
  { title: 'เงื่อนไขการใช้งาน', icon: 'document-text-outline' },
  { title: 'นโยบายความเป็นส่วนตัว', icon: 'shield-checkmark-outline' },
  {
    title: 'เวอร์ชันแอปพลิเคชัน',
    value: '1.0.0',
    icon: 'phone-portrait-outline',
  },
];
