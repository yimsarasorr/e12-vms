import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalController } from '@ionic/angular';
import { IonicModule } from '@ionic/angular';

@Component({
    selector: 'app-booking-type-selector',
    templateUrl: './booking-type-selector.component.html',
    styleUrls: ['./booking-type-selector.component.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule]
})
export class BookingTypeSelectorComponent implements OnInit {

    bookingTypes = [
        {
            id: 'daily',
            title: 'รายชั่วโมง (ทั่วไป)',
            desc: 'จองตามระยะเวลาจริง เริ่มต้น 20 บ./ชม.',
            icon: 'time-outline',
            color: 'primary',
            hexColor: '#3b82f6', // Tailwind blue-500
            badge: null
        },
        {
            id: 'flat24',
            title: 'เหมาจ่าย 24 ชม.',
            desc: 'จอดได้ยาว 24 ชั่วโมง ราคาพิเศษ',
            icon: 'sync-circle-outline',
            color: 'success',
            hexColor: '#10b981', // Tailwind green-500
            badge: 'สุดคุ้ม'
        },
        {
            id: 'monthly',
            title: 'สมาชิกรายเดือน',
            desc: 'จอดได้ตลอด 24 ชม. ไม่จำกัดจำนวนครั้ง',
            icon: 'calendar-number-outline',
            color: 'tertiary',
            hexColor: '#8b5cf6', // Tailwind violet-500
            badge: null
        },

    ];

    constructor(private modalCtrl: ModalController) { }

    ngOnInit() { }

    selectType(typeId: string) {
        this.modalCtrl.dismiss({ bookingMode: typeId }, 'confirm');
    }

    close() {
        this.modalCtrl.dismiss(null, 'cancel');
    }

}
