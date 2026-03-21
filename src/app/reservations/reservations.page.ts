import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Booking } from '../data/models';
import { ParkingDataService } from '../services/parking-data.service';
import { ReservationService } from '../services/reservation.service';
import { ReservationDetailComponent } from '../modal/reservation-detail/reservation-detail.component';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-reservations',
  templateUrl: 'reservations.page.html',
  styleUrls: ['reservations.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
})
export class ReservationsPage implements OnInit, OnDestroy {

  // Dropdown options
  selectedMonth: string = 'all';
  selectedCategory: string = 'all';

  // Search
  searchQuery: string = '';
  showSearch: boolean = false;
  isSearching: boolean = false;

  private searchSubject = new Subject<string>();
  private searchSub!: Subscription;

  // Options for Selectors
  monthOptions: { value: string, label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' }
  ];

  categoryOptions = [
    { value: 'all', label: 'รายการทั้งหมด' },
    { value: 'hourly', label: 'รายชั่วโมง' },
    { value: 'flat_24h', label: 'เหมาจ่าย 24 ชม.' },
    { value: 'monthly_regular', label: 'รายเดือน' },
  ];

  // Segment for Status
  selectedStatusSegment: string = 'in_progress'; // 'in_progress' | 'completed' | 'cancelled'

  // Combined Display Array
  displayBookings: Booking[] = [];

  // Expanded state for the single list
  isExpanded: boolean = false;

  allBookings: Booking[] = [];

  // Subscription for Realtime updates
  reservationsSubscription: any;

  // Loading State
  isLoading: boolean = false;

  constructor(
    private parkingService: ParkingDataService,
    private reservationService: ReservationService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController
  ) { }

  ngOnInit() {
    this.parkingService.bookings$.subscribe(bookings => {
      this.allBookings = bookings;
      this.updateFilter();
    });

    this.reservationService.currentProfileId$.subscribe(async (userId: string) => {
      if (userId) {
        await this.loadRealReservations();

        if (this.reservationsSubscription) {
          this.reservationsSubscription.unsubscribe();
        }
        this.setupRealtimeSubscription();
      }
    });

    this.searchSub = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(() => {
      this.updateFilter();
      this.isSearching = false;
    });
  }

  ngOnDestroy() {
    if (this.searchSub) {
      this.searchSub.unsubscribe();
    }
  }

  async ionViewWillEnter() {
    await this.loadRealReservations();
    this.setupRealtimeSubscription();
  }

  ionViewWillLeave() {
    if (this.reservationsSubscription) {
      this.reservationsSubscription.unsubscribe();
      this.reservationsSubscription = null;
    }
  }

  setupRealtimeSubscription() {
    if (this.reservationsSubscription) {
      return;
    }

    this.reservationsSubscription = this.reservationService.subscribeToUserReservations(() => {
      this.loadRealReservations();
    });
  }

  async loadRealReservations(event?: any) {
    try {
      if (!event) {
        this.isLoading = true;
      }
      const reservations = await this.reservationService.getUserReservationsFromEdge();

      if (reservations) {
        const mappedBookings: Booking[] = reservations.map((r: any) => {
          const lot = this.parkingService.getParkingLotById(r.parking_site_id);

          let status: any = 'pending_payment';
          let statusLabel = 'รอชำระเงิน';

          switch (r.status) {
            case 'pending':
              status = 'pending';
              statusLabel = 'กำลังตรวจสอบรายการ';
              break;
            case 'pending_payment':
              status = 'pending_payment';
              statusLabel = 'รอชำระเงิน';
              break;
            case 'checked_in_pending_payment':
              status = 'checked_in_pending_payment';
              statusLabel = 'กำลังจอด (รอชำระเงิน)';
              break;
            case 'confirmed':
              status = 'confirmed';
              statusLabel = 'เสร็จสิ้น';
              break;
            case 'checked_in':
            case 'active':
              status = 'active';
              statusLabel = 'กำลังจอด';
              break;
            case 'checked_out':
            case 'completed':
              status = 'completed';
              statusLabel = 'เสร็จสิ้น';
              break;
            case 'cancelled':
              status = 'cancelled';
              statusLabel = 'ยกเลิกแล้ว';
              break;
            default:
              status = r.status;
              statusLabel = r.status;
          }

          let zoneLabel = '-';
          let floorLabel = '-';
          let buildingLabel = '-';
          let derivedPlaceName = null;

          if (r.slot_id) {
            const parts = r.slot_id.split('-');
            if (parts.length >= 2) {
              const buildingId = `${parts[0]}-${parts[1]}`;
              const derivedLot = this.parkingService.getParkingLotById(buildingId);
              if (derivedLot) {
                derivedPlaceName = derivedLot.name;
              }
            }

            if (parts.length >= 5) {
              buildingLabel = parts[1];
              floorLabel = parts[2];
              const zoneNum = parseInt(parts[3], 10);
              if (!isNaN(zoneNum) && zoneNum >= 1 && zoneNum <= 26) {
                zoneLabel = String.fromCharCode(64 + zoneNum);
              } else {
                zoneLabel = parts[3];
              }
            }
          }

          let placeName = derivedPlaceName || (lot ? lot.name : (r.parking_site_id || 'Unknown Location'));
          const bookingType = r.booking_type || 'hourly';
          const bookingDate = (r.start_time.includes('Z') || r.start_time.includes('+')) ? new Date(r.start_time) : new Date(r.start_time + 'Z');
          const endDate = (r.end_time.includes('Z') || r.end_time.includes('+')) ? new Date(r.end_time) : new Date(r.end_time + 'Z');

          let periodLabel: string | undefined = undefined;
          if (bookingType === 'monthly_regular' || bookingType === 'monthly_night') {
            const startStr = bookingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const calculatedEndDate = new Date(bookingDate);
            calculatedEndDate.setMonth(calculatedEndDate.getMonth() + 1);
            const endStr = calculatedEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            periodLabel = `${startStr} - ${endStr}`;
          }

          let dateLabel: string | undefined = undefined;
          if (bookingType === 'hourly' || bookingType === 'flat_24h' || bookingType === 'daily') {
            const isSameDay = bookingDate.getDate() === endDate.getDate() &&
              bookingDate.getMonth() === endDate.getMonth() &&
              bookingDate.getFullYear() === endDate.getFullYear();
            if (!isSameDay) {
              const startStr = bookingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              const endStr = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              dateLabel = `${startStr} - ${endStr}`;
            }
          }

          return {
            id: r.id,
            placeName: placeName,
            locationDetails: `ตึก ${buildingLabel} ชั้น ${floorLabel} | โซน ${zoneLabel} | ${r.slot_id || '-'}`,
            bookingTime: bookingDate,
            endTime: endDate,
            status: status,
            statusLabel: statusLabel,
            price: r.total_amount || 0,
            carBrand: r.cars?.model || 'ไม่ระบุ',
            licensePlate: r.car_plate ? `${r.car_plate}${r.cars?.province ? ' ' + r.cars.province : ''}` : 'ไม่ระบุทะเบียน',
            bookingType: bookingType,
            periodLabel: periodLabel,
            building: buildingLabel,
            floor: floorLabel,
            zone: zoneLabel,
            slot: r.slot_id || '-',
            vehicleType: r.vehicle_type,
            carId: r.car_id,
            dateLabel: dateLabel,
            reservedAt: (r.reserved_at && (r.reserved_at.includes('Z') || r.reserved_at.includes('+'))) ? new Date(r.reserved_at) : (r.reserved_at ? new Date(r.reserved_at + 'Z') : new Date()),
            lat: lot?.lat || lot?.mapX,
            lng: lot?.lng || lot?.mapY
          } as Booking;
        });

        this.allBookings = mappedBookings;
        this.allBookings.sort((a, b) => {
          const timeA = a.reservedAt ? a.reservedAt.getTime() : 0;
          const timeB = b.reservedAt ? b.reservedAt.getTime() : 0;
          return timeB - timeA;
        });

        this.generateMonthOptions();
        this.updateFilter();
      }
    } catch (error) {
      console.error('Error loading real reservations:', error);
    } finally {
      this.isLoading = false;
      if (event) {
        event.target.complete();
      }
    }
  }

  doRefresh(event: any) {
    this.loadRealReservations(event);
  }

  segmentChanged(event: any) {
    this.selectedStatusSegment = event.detail.value;
    this.updateFilter();
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) {
      this.searchQuery = '';
      this.isSearching = false;
      this.updateFilter();
    }
  }

  onSearch() {
    this.isSearching = true;
    this.searchSubject.next(this.searchQuery);
  }

  selectMonth(val: string) {
    this.selectedMonth = val;
    this.updateFilter();
  }

  selectCategory(val: string) {
    this.selectedCategory = val;
    this.updateFilter();
  }

  getSelectedMonthLabel(): string {
    const opt = this.monthOptions.find(o => o.value === this.selectedMonth);
    return opt ? opt.label : 'เดือนทั้งหมด';
  }

  getSelectedCategoryLabel(): string {
    const opt = this.categoryOptions.find(o => o.value === this.selectedCategory);
    return opt ? opt.label : 'ประเภททั้งหมด';
  }

  generateMonthOptions() {
    const months = new Set<string>();
    this.allBookings.forEach(b => {
      const d = new Date(b.bookingTime);
      if (isNaN(d.getTime())) return;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      months.add(`${yyyy}-${mm}`);
    });

    this.monthOptions = [{ value: 'all', label: 'ทั้งหมด' }];
    Array.from(months).sort((a, b) => b.localeCompare(a)).forEach(m => {
      const [yyyy, mm] = m.split('-');
      const d = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
      const thaiMonth = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
      this.monthOptions.push({ value: m, label: thaiMonth });
    });
  }

  updateFilter() {
    let filtered = this.allBookings.filter(b => {
      let statusMatch = false;
      if (this.selectedStatusSegment === 'in_progress') {
        statusMatch = ['active', 'pending_payment', 'pending', 'checked_in_pending_payment'].includes(b.status);
      } else if (this.selectedStatusSegment === 'cancelled') {
        statusMatch = b.status === 'cancelled';
      } else {
        statusMatch = b.status === 'completed' || b.status === 'confirmed';
      }

      let monthMatch = true;
      if (this.selectedMonth !== 'all') {
        const d = new Date(b.bookingTime);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const key = `${yyyy}-${mm}`;
        monthMatch = key === this.selectedMonth;
      }

      let catMatch = true;
      if (this.selectedCategory !== 'all') {
        catMatch = b.bookingType === (this.selectedCategory as any);
      }

      let searchMatch = true;
      if (this.searchQuery.trim() !== '') {
        const q = this.searchQuery.toLowerCase().trim();
        searchMatch = !!(
          (b.placeName && b.placeName.toLowerCase().includes(q)) ||
          (b.carId && b.carId.toLowerCase().includes(q)) ||
          (b.licensePlate && b.licensePlate.toLowerCase().includes(q)) ||
          (b.building && b.building.toLowerCase().includes(q)) ||
          (b.zone && b.zone.toLowerCase().includes(q)) ||
          (b.slot && b.slot.toLowerCase().includes(q))
        );
      }

      return statusMatch && monthMatch && catMatch && searchMatch;
    });

    filtered.sort((a, b) => new Date(a.bookingTime).getTime() - new Date(b.bookingTime).getTime());
    this.displayBookings = filtered;
  }

  getBookingTypeLabel(type: string | undefined): string {
    switch (type) {
      case 'hourly': return 'รายชั่วโมง';
      case 'flat_24h': return 'เหมาจ่าย 24 ชม.';
      case 'monthly_regular': return 'รายเดือน';
      case 'monthly_night': return 'รายเดือน (กลางคืน)';
      default: return 'ทั่วไป';
    }
  }

  getVehicleTypeLabel(type: string | undefined): string {
    switch (type) {
      case 'car': return 'รถยนต์';
      case 'motorcycle': return 'รถจักรยานยนต์';
      case 'ev': return 'รถยนต์ไฟฟ้า (EV)';
      case 'other': return 'อื่นๆ';
      default: return type || 'ไม่ระบุ';
    }
  }

  getBookingTypeClass(type: string | undefined): string {
    switch (type) {
      case 'hourly': return 'bg-blue-50 text-blue-600 border border-blue-100';
      case 'flat_24h': return 'bg-green-50 text-green-600 border border-green-100';
      case 'monthly_regular':
      case 'monthly_night': return 'bg-purple-50 text-purple-600 border border-purple-100';
      default: return 'bg-gray-50 text-gray-600 border border-gray-100';
    }
  }

  getStatusClass(item: Booking): string {
    if (item.status === 'pending') return 'text-sky-500';
    if (item.status === 'pending_payment') return 'text-orange-500';
    if (item.status === 'checked_in_pending_payment') return 'text-orange-600 font-bold italic';
    if (item.status === 'active') return 'text-green-600';
    if (item.status === 'confirmed') return 'text-[var(--ion-color-primary)]';
    if (item.status === 'completed') return 'text-gray-500';
    if (item.status === 'cancelled') return 'text-red-500';
    return '';
  }

  toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  openMap(lat?: number, lng?: number) {
    if (!lat || !lng) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  }

  async handleFooterClick(item: Booking) {
    const modal = await this.modalCtrl.create({
      component: ReservationDetailComponent,
      componentProps: { booking: item },
      initialBreakpoint: 1,
      breakpoints: [0, 1],
      backdropDismiss: true,
      showBackdrop: true,
      cssClass: 'detail-sheet-modal',
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {
      if (data.action === 'cancel') {
        try {
          await this.reservationService.updateReservationStatusv2(item.id, 'cancelled');
          const toast = await this.toastCtrl.create({
            message: 'ยกเลิกการจองสำเร็จ',
            duration: 2000,
            color: 'success',
            position: 'top'
          });
          toast.present();
          this.loadRealReservations();
        } catch (e) {
          console.error(e);
        }
      } else if (data.action === 'checkout') {
        try {
          await this.reservationService.updateReservationStatusv2(item.id, 'confirmed');
          const toast = await this.toastCtrl.create({
            message: `ยืนยันสถานะสำเร็จ`,
            duration: 3000,
            color: 'success',
            position: 'top'
          });
          toast.present();
          this.loadRealReservations();
        } catch (e) {
          console.error(e);
        }
      } else if (data.action === 'receipt') {
        this.loadRealReservations();
      }
    }
  }
}
