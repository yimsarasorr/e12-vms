import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../services/supabase.service';
import { ModalController, ToastController, LoadingController, AlertController } from '@ionic/angular';
import { IonicModule } from '@ionic/angular';
import { ParkingLot, Booking } from '../../data/models';
import { ParkingDataService } from '../../services/parking-data.service';

import { CheckBookingComponent } from '../check-booking/check-booking.component';
import { BookingSlotComponent } from '../booking-slot/booking-slot.component';
import { BookingSuccessModalComponent } from '../booking-success-modal/booking-success-modal.component';
import { ReservationService } from '../../services/reservation.service';
import { ParkingService } from '../../services/parking.service';
import { UiEventService } from '../../services/ui-event';
import { AddVehicleModalComponent } from '../add-vehicle/add-vehicle-modal.component';
import { take } from 'rxjs/operators';

// --- Interfaces copied from ParkingReservations ---
interface DaySection {
  date: Date;
  dateLabel: string; // Full label for backup
  dayName: string;   // e.g. "Thu"
  dateNumber: string; // e.g. "15"
  timeLabel: string;
  slots: TimeSlot[];
  available: number;
  capacity: number;
}

interface TimeSlot {
  id: string;
  timeText: string;
  dateTime: Date;
  isAvailable: boolean;
  isSelected: boolean;
  isInRange: boolean;
  remaining: number;
  isUserReserved?: boolean; // NEW: If car already has reservation during this slot
  originalRemaining?: number; // Store raw availability from API
  duration?: number;
}

interface ZoneData {
  id: string;
  name: string;
  available: number;
  capacity: number;
  status: 'available' | 'full';
}

interface FloorData {
  id: string;
  name: string;
  zones: ZoneData[];
  totalAvailable: number;
  capacity: number;
}

interface DailySchedule {
  dayName: string;
  timeRange: string;
  isToday: boolean;
}

interface AggregatedZone {
  name: string;
  available: number;
  capacity: number;
  status: 'available' | 'full';
  floorIds: string[];
  ids: string[];
}

@Component({
  selector: 'app-parking-detail',
  templateUrl: './parking-detail.component.html',
  styleUrls: ['./parking-detail.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class ParkingDetailComponent implements OnInit, OnDestroy {

  @Input() lot!: ParkingLot;
  @Input() initialType: string = 'normal';
  @Input() bookingMode: 'daily' | 'monthly' | 'flat24' = 'daily';

  availableSites: ParkingLot[] = [];
  weeklySchedule: DailySchedule[] = [];
  isOpenNow = false;
  todayCloseTime: string = '20:00'; // Default

  selectedType = 'normal';

  // --- Time Selection State ---
  slotInterval: number = 60; // -1 = Full Day, -2 = Half Day
  displayDays: DaySection[] = [];
  selectedDateIndex: number = 0; // NEW: Track selected date
  currentMonthLabel: string = ''; // NEW: Month Year Label (e.g. January 2026)
  currentDisplayedDate: Date = new Date(); // NEW: For Month Navigation

  startSlot: TimeSlot | null = null;
  endSlot: TimeSlot | null = null;

  // --- Floor & Zone Data ---
  floorData: FloorData[] = [];

  // Selection State (Multiple Floors)
  selectedFloorIds: string[] = [];

  // Selection State (Multiple Zones - actual IDs)
  selectedZoneIds: string[] = [];

  // Aggregated Zones for Display
  displayZones: AggregatedZone[] = [];

  userCarReservations: {start_time: string, end_time: string}[] = [];

  currentImageIndex = 0;
  isSpecificSlot: boolean = true; // Default to true per user intent (selecting zones)
  crossDayCount: number = 1;
  minDate: string = new Date().toISOString(); // Validator
  isBooking: boolean = false; // Loading state for booking process
  private realtimeChannel: RealtimeChannel | null = null;

  constructor(
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private parkingDataService: ParkingDataService, // Old Mock
    private parkingApiService: ParkingService, // New RPC Service
    private reservationService: ReservationService,
    private uiEventService: UiEventService,
    private router: Router,
    private supabaseService: SupabaseService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    // Subscribe to ParkingDataService (Keep as backup or for other components)
    this.parkingDataService.parkingLots$.subscribe(sites => {
      if (this.availableSites.length === 0) {
        this.availableSites = sites;
      }
    });

    // --- CRITICAL FIX: Fetch Real Data from RPC ---
    // The initial 'lot' input might lack schedule data if it came from a simplified source.
    // We explicitly fetch the site buildings via the proper Service (Edge Function/RPC) 
    // to guarantee we have the 'schedule' field populated.
    if (this.lot && this.lot.id) {
      const siteId = this.lot.id.split('-')[0];
      const profileId = this.reservationService.getCurrentProfileId(); // Get current user id
      
      this.parkingApiService.getSiteBuildings(siteId, 0, 0, profileId).subscribe(realSites => {
        if (realSites && realSites.length > 0) {
          console.log('Refreshed Site Data from RPC:', realSites);
          this.availableSites = realSites;

          // Update current lot with fresh data (containing schedule)
          const freshLot = realSites.find(s => s.id === this.lot.id);
          if (freshLot) {
            console.log('Updated ' + this.lot.name + ' with fresh schedule:', freshLot.schedule);
            this.lot = freshLot;

            // Re-run initialization with correct data
            this.checkOpenStatus();
            this.generateWeeklySchedule();
            this.generateTimeSlots();

            // Refresh Realtime Data
            this.refreshRealtimeData();
          }
        }
      });
    }

    if (this.initialType && this.lot.supportedTypes.includes(this.initialType)) {
      this.selectedType = this.initialType;
    } else if (this.lot.supportedTypes.length > 0) {
      this.selectedType = this.lot.supportedTypes[0];
    }

    this.checkOpenStatus();
    this.generateWeeklySchedule();

    // Generate Time Slots initially (will be regenerated when RPC returns)
    this.generateTimeSlots();

    // Subscribe to Realtime Updates (Reservations Table)
    this.realtimeChannel = this.supabaseService.client
      .channel('public:reservations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        (payload) => {
          console.log('Realtime Update:', payload);
          this.refreshRealtimeData();
        }
      )
      .subscribe();

    // Fetch user car reservations initially
    this.loadUserCarReservations();
  }

  async loadUserCarReservations() {
    this.parkingDataService.vehicles$.pipe(take(1)).subscribe(async vehicles => {
      if (vehicles && vehicles.length > 0) {
        try {
          const res = await this.reservationService.getCarReservations(vehicles[0].id);
          this.userCarReservations = res;
          this.generateTimeSlots(); // Re-generate to apply disable logic
        } catch (e) {
          console.error('Error loading car reservations:', e);
        }
      }
    });
  }

  ngOnDestroy() {
    if (this.realtimeChannel) {
      this.supabaseService.client.removeChannel(this.realtimeChannel);
    }
  }

  refreshRealtimeData() {
    // 0. Refresh Car Reservations (to handle cancellations)
    this.loadUserCarReservations();

    // 1. Refresh Time Slots (Counts)
    this.fetchTimeSlotAvailability();

    // 2. Refresh Floor/Zone logic if a slot is selected
    if (this.startSlot && this.endSlot) {
      this.loadAvailability(true);
    }
  }

  // --- Date Selection ---
  selectDate(index: number) {
    this.selectedDateIndex = index;
    // this.updateMonthLabel(); // Removed: specific to slot gen now
    this.updateSelectionUI();
  }

  // --- Month Navigation ---
  changeMonth(offset: number) {
    const newDate = new Date(this.currentDisplayedDate);
    newDate.setMonth(newDate.getMonth() + offset);

    // Prevent going back before current month
    const today = new Date();
    if (offset < 0 && newDate.getMonth() < today.getMonth() && newDate.getFullYear() <= today.getFullYear()) {
      // Don't go back further than current month 
      // Although ion-datetime handles [min], manual nav needs check
      // Actually simpler: just don't disable if same month
    }
    this.currentDisplayedDate = newDate;

    // Reset selection when changing month in Monthly mode? Maybe yes.
    // this.resetTimeSelection(); // Optional: Keep it or clear it. 
    this.generateTimeSlots();
  }

  get isPrevMonthDisabled(): boolean {
    const today = new Date();
    // Compare Year & Month
    return this.currentDisplayedDate.getFullYear() <= today.getFullYear() &&
      this.currentDisplayedDate.getMonth() <= today.getMonth();
  }

  updateMonthLabel() {
    // Label is now set in generateTimeSlots for Monthly, or dynamic for Daily
    if (this.bookingMode === 'daily' || this.bookingMode === 'flat24') {
      if (this.displayDays.length > 0 && this.displayDays[this.selectedDateIndex]) {
        const date = this.displayDays[this.selectedDateIndex].date;
        const monthNames = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        this.currentMonthLabel = `${monthNames[date.getMonth()]} ${date.getFullYear() + 543}`;
      }
    }
  }

  // --- Time Selection Logic ---

  selectInterval(minutes: number) {
    this.slotInterval = minutes;
    // Capture old time
    const oldTime = this.startSlot ? this.startSlot.dateTime.getTime() : null;

    this.resetTimeSelection(false);
    this.generateTimeSlots();

    // Try to restore selection
    if (oldTime) {
      // Find matching slot in NEW slots
      let newSlot: TimeSlot | undefined;
      for (const day of this.displayDays) {
        newSlot = day.slots.find(s => s.dateTime.getTime() === oldTime);
        if (newSlot) break;
      }

      if (newSlot) {
        this.startSlot = newSlot;
        this.endSlot = newSlot;
        // Trigger UI update and Load Detail
        this.updateSelectionUI();
        this.loadAvailability(true);
      }
    }

    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();
  }



  selectCrossDayCount(count: number) {
    this.crossDayCount = count;
    this.resetTimeSelection();
    // Dismiss popover
    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();

    // Auto-scroll logic similar to before
    if (this.crossDayCount > 1) {
      setTimeout(() => {
        const el = document.getElementById('month-section-header');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }

  get dayIndices(): number[] {
    // Returns [0], [0,1], [0,1,2] etc based on crossDayCount
    // But relative to selectedDateIndex. 
    // Wait, the original logic was: let dayIndex of (isCrossDay ? [selectedDateIndex, selectedDateIndex + 1] : [selectedDateIndex])
    // So we should generate indices starting from selectedDateIndex
    return Array.from({ length: this.crossDayCount }, (_, i) => this.selectedDateIndex + i);
  }

  resetTimeSelection(fullReset: boolean = true) {
    this.startSlot = null;
    this.endSlot = null;
    if (fullReset) {
      this.selectedDateIndex = 0;
      // Do NOT reset currentDisplayedDate here, keep invisible state
    }
    this.floorData = [];
    this.selectedFloorIds = [];
    this.selectedZoneIds = [];
    this.displayZones = [];
    this.updateSelectionUI();
  }

  generateTimeSlots() {
    console.log('Generating slots for:', this.lot?.name, 'Mode:', this.bookingMode);

    this.displayDays = [];
    // Use currentDisplayedDate for Monthly, today for others (unless we want navigable daily?) 
    // Usually Daily starts from Today.
    const baseDate = (this.bookingMode === 'monthly') ? this.currentDisplayedDate : new Date();

    // Thai Days (Full Names)
    const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

    if (this.bookingMode === 'monthly') {
      // --- MONTHLY MODE: REAL CALENDAR VIEW ---
      this.currentMonthLabel = `${thaiMonths[baseDate.getMonth()]} ${baseDate.getFullYear() + 543}`;

      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      // Calculate padding (0=Sun, 6=Sat)
      const startDay = firstDay.getDay();

      // Add Emtpy Slots for Padding
      for (let i = 0; i < startDay; i++) {
        this.displayDays.push({
          date: new Date(year, month, 0), // Dummy
          dateLabel: '',
          dayName: '',
          dateNumber: '',
          timeLabel: 'padding',
          slots: [], // Empty slots = Padding
          available: 0,
          capacity: 0
        });
      }

      for (let i = 1; i <= daysInMonth; i++) {
        const targetDate = new Date(year, month, i);
        const dayIndex = targetDate.getDay();
        const dailyCapacity = this.getCurrentCapacity();

        // Check if Past Date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isPast = targetDate < today;

        // Deterministic: Use date and capacity to determine available count
        // Pattern: Even days have 80% availability, Odd days have 40%
        // Deterministic: Always show full availability as requested
        let dailyAvailable = dailyCapacity;
        if (isPast) dailyAvailable = 0; // Past dates unavailable

        const timeStr = this.bookingMode === 'monthly' ? 'เริ่มสัญญา' : 'เริ่ม 18:00';

        const slots: TimeSlot[] = [{
          id: `${targetDate.toISOString()}-MONTHLY`,
          timeText: timeStr,
          dateTime: new Date(targetDate),
          isAvailable: !isPast, // Disable logic
          remaining: dailyAvailable,
          isSelected: false,
          isInRange: false,
          duration: 0
        }];

        this.displayDays.push({
          date: targetDate,
          dateLabel: `${i}`,
          dayName: thaiDays[dayIndex],
          dateNumber: i.toString(),
          timeLabel: 'ว่าง',
          slots: slots,
          available: dailyAvailable,
          capacity: dailyCapacity
        });
      }

    } else {
      // --- DAILY / HOURLY / 24H MODE ---
      // Use Today for these modes
      const today = new Date();

      for (let i = 0; i < 5; i++) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + i);

        const dayIndex = targetDate.getDay();
        const dayName = thaiDays[dayIndex];
        const dateNumber = targetDate.getDate().toString();
        const dateLabel = `${dayName} ${dateNumber}`;

        // Mock capacity/availability
        const dailyCapacity = this.getCurrentCapacity();
        let dailyAvailable = 0;
        // Deterministic: 
        if (i === 0) {
          dailyAvailable = Math.min(this.getCurrentAvailable(), dailyCapacity);
        } else {
          // Deterministic: Always show full availability as requested
          dailyAvailable = dailyCapacity;
        }

        let startH = 8, startM = 0;
        let endH = 20, endM = 0;
        let isOpen = false;
        let timeLabel = 'ปิดบริการ';

        const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDayKey = dayKeys[dayIndex];

        if (this.lot && this.lot.schedule && this.lot.schedule.length > 0) {
          const schedule = this.lot.schedule.find(s => s.days.includes(currentDayKey));
          if (schedule) {
            isOpen = true;
            const [oH, oM] = schedule.open_time.split(':').map(Number);
            const [cH, cM] = schedule.close_time.split(':').map(Number);
            startH = oH; startM = oM;
            endH = cH; endM = cM;
            timeLabel = `${schedule.open_time.slice(0, 5)} - ${schedule.close_time.slice(0, 5)}`;
          } else {
            // Schedule exists but not for this day -> Closed
            isOpen = false;
          }
        } else {
          // Fallback: 24 Hours
          isOpen = true;
          timeLabel = '24 ชั่วโมง';
          startH = 0; endH = 24;
        }

        console.log(`Day: ${dayName} (${currentDayKey}), IsOpen: ${isOpen}, Time: ${timeLabel}`);

        const slots: TimeSlot[] = [];
        const startTime = new Date(targetDate);
        startTime.setHours(startH, startM, 0, 0);
        const closingTime = new Date(targetDate);
        closingTime.setHours(endH, endM, 0, 0);

        const totalOpenMinutes = Math.floor((closingTime.getTime() - startTime.getTime()) / 60000);

        if (!isOpen) {
          // Closed logic handled below by empty slots
        } else {

          // --- ADAPTED LOGIC FOR BOOKING MODES ---
          // NOTE: flat24 moved to loop logic below to allow start time selection

          if (this.slotInterval === -1) {
            // Full Day
            const timeStr = `${this.pad(startH)}:${this.pad(startM)} - ${this.pad(endH)}:${this.pad(endM)}`;
            const isPast = startTime < new Date();
            let remaining = 0;
            if (!isPast) remaining = Math.floor(Math.random() * dailyCapacity) + 1;

            slots.push({
              id: `${targetDate.toISOString()}-FULL`,
              timeText: timeStr,
              dateTime: new Date(startTime),
              isAvailable: remaining > 0,
              remaining: remaining,
              isSelected: false,
              isInRange: false,
              duration: totalOpenMinutes
            });
          } else if (this.slotInterval === -2) {
            // Half Day logic...
            const halfDuration = Math.floor(totalOpenMinutes / 2);
            const slot1Time = new Date(startTime);
            this.createSingleSlot(slots, targetDate, slot1Time, dailyCapacity, halfDuration);
            const slot2Time = new Date(startTime.getTime() + halfDuration * 60000);
            if (slot2Time < closingTime) {
              this.createSingleSlot(slots, targetDate, slot2Time, dailyCapacity, halfDuration);
            }
          } else {
            // Interval (Standard OR Flat24)
            // If Flat24, we use interval for start times, but duration is 24h (1440 min)
            // And maybe we want to show "10:00 (+1 day)" label style in createSingleSlot?

            let currentBtnTime = new Date(startTime);
            while (currentBtnTime < closingTime) {
              // Valid Start Time
              let duration = this.slotInterval;
              if (this.bookingMode === 'flat24') {
                duration = 1440; // 24 Hours fixed
              }

              this.createSingleSlot(slots, targetDate, currentBtnTime, dailyCapacity, duration);

              // Increment Step:
              // For 'daily' (Hourly/4h), step by the interval itself to create distinct rounds (8-12, 12-16)
              // For 'flat24', step by 60 mins to allow flexible start times (8-8, 9-9)
              const step = this.bookingMode === 'flat24' ? 60 : this.slotInterval;
              currentBtnTime.setMinutes(currentBtnTime.getMinutes() + step);
            }
          }
        }

        this.displayDays.push({
          date: targetDate,
          dateLabel: dateLabel,
          dayName: dayName,
          dateNumber: dateNumber,
          timeLabel: isOpen ? timeLabel : 'ปิดบริการ',
          slots: slots,
          available: dailyAvailable,
          capacity: dailyCapacity
        });
      }
      this.updateMonthLabel(); // Only for daily modes
    }

    // Fetch real availability for the generated slots
    this.fetchTimeSlotAvailability();

    this.updateSelectionUI();
  }

  // --- Date Picker Handler ---
  onMonthSelected(event: any) {
    const val = event.detail.value;
    if (val) {
      this.currentDisplayedDate = new Date(val);
      this.generateTimeSlots();
      // Dismiss popover programmatically if needed, or let backdrop handle it
      const popover = document.querySelector('ion-popover.date-picker-popover') as any;
      if (popover) popover.dismiss();
    }
  }

  createSingleSlot(slots: TimeSlot[], targetDate: Date, timeObj: Date, capacity: number, duration: number) {
    const startH = timeObj.getHours();
    const startM = timeObj.getMinutes();
    const endTime = new Date(timeObj.getTime() + duration * 60000);
    const endH = endTime.getHours();
    const endM = endTime.getMinutes();

    let timeStr = `${this.pad(startH)}:${this.pad(startM)} - ${this.pad(endH)}:${this.pad(endM)}`;

    // Custom label for Flat 24
    if (this.bookingMode === 'flat24') {
      timeStr = `${this.pad(startH)}:${this.pad(startM)} (24 ชม.)`;
    }

    const isPast = timeObj < new Date();
    // Default to 0, will be updated by fetchTimeSlotAvailability
    let remaining = isPast ? 0 : capacity;

    slots.push({
      id: `${targetDate.toISOString()}-${timeStr}`,
      timeText: timeStr,
      dateTime: new Date(timeObj),
      isAvailable: !isPast, // Optimistic, will update
      remaining: remaining,
      isSelected: false,
      isInRange: false,
      duration: duration
    });
  }

  fetchTimeSlotAvailability() {
    if (!this.lot || !this.parkingApiService || this.displayDays.length === 0) return;

    // Default to the first day's date
    let startDate = new Date(this.displayDays[0].date);

    // Force start date to midnight initially
    startDate.setHours(0, 0, 0, 0);

    // ADJUST START TIME TO MATCH BUILDING OPEN TIME
    // This ensures the generated time series (p_start_time + n * interval) matches the actual slot times
    if (this.lot && this.lot.schedule) {
      const daysKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayKey = daysKey[startDate.getDay()];
      const schedule = this.lot.schedule.find(s => s.days.includes(dayKey));
      if (schedule && schedule.open_time) {
        const [h, m] = schedule.open_time.split(':').map(Number);
        startDate.setHours(h, m, 0, 0);
      }
    }

    const lastDay = this.displayDays[this.displayDays.length - 1].date;
    const endDate = new Date(lastDay);
    // Extend end date by 2 days to ensure we cover the full duration of bookings 
    // starting on the last day (e.g. 24h flat rate extending into the next day)
    endDate.setDate(endDate.getDate() + 2);
    endDate.setHours(23, 59, 59, 999);

    // Determine interval from booking mode
    let interval = this.slotInterval;

    if (this.bookingMode === 'flat24') {
      interval = 60; // Fetch hourly for flat24 too? Or larger?
    } else if (interval < 0) {
      // For Full Day (-1) or Half Day (-2), use the duration of the generated slots
      // This ensures the API checks the full required duration (e.g. 12 hours) 
      // instead of just 1 hour availability at the start time.
      const firstDayWithSlots = this.displayDays.find(d => d.slots.length > 0);
      if (firstDayWithSlots && firstDayWithSlots.slots.length > 0) {
        interval = firstDayWithSlots.slots[0].duration || 720;
      } else {
        interval = 720; // Default 12 hours if no slots found yet
      }
    }

    if (interval <= 0) interval = 60; // Safety fallback

    const buildingId = this.lot.id;
    // Check if selectedLot.id is actually the building ID or site ID?
    // In getSiteBuildings, likely building.id.

    // Convert vehicle type? The component might calculate this.
    const vehicleType = this.selectedType === 'motorcycle' ? 'motorcycle' : (this.selectedType === 'ev' ? 'ev' : 'car');

    // Pass 'duration' explicitly for overlapping checks (e.g. 1440 for flat24)
    // For normal daily mode, interval == duration usually.
    let durationToCheck = interval;
    if (this.bookingMode === 'flat24') {
      durationToCheck = 1440;
    } else if (interval < 0) {
      // Full day / Half day logic
      const firstDayWithSlots = this.displayDays.find(d => d.slots.length > 0); // Re-declare or ensure scope
      if (firstDayWithSlots && firstDayWithSlots.slots.length > 0) {
        durationToCheck = firstDayWithSlots.slots[0].duration || 720;
      } else {
        durationToCheck = 720;
      }
    }

    this.parkingApiService.getBuildingTimeSlots(buildingId, startDate, endDate, interval, vehicleType, durationToCheck)
      .subscribe(data => {
        // Map data to slots
        // data: { slot_time: string, available_count: number, ... }[]

        // Create a lookup map for speed
        // ✅ 1. ใช้ Map ที่เก็บ Key เป็น ISO String เพื่อความเป็นกลางทาง Timezone
        const availabilityMap = new Map<string, number>();
        data.forEach((row: any) => {
          // Normalize time string to match slot.dateTime.toISOString() or similar comparison
          // User updated RPC to return 't_start' and aligned times
          const timeVal = row.t_start || row.slot_time;
          if (timeVal) {
            // แปลงเป็น ISO String และล้างวินาที/มิลลิวินาทีให้สะอาด
            const d = new Date(timeVal);
            d.setSeconds(0, 0);
            availabilityMap.set(d.toISOString(), row.available_count);
          }
        });

        // Update slots
        // ✅ 2. อัปเดต UI โดยการเทียบ Key ในรูปแบบเดียวกัน
        const intervalMs = interval * 60000;

        this.displayDays.forEach(day => {
          day.slots.forEach(slot => {
            const slotTime = slot.dateTime.getTime();

            // Generate aligned key: Find the interval bucket that contains this slot
            // Since SQL generated series from Midnight with 'interval' steps, we align to that.
            // Using local time offset logic might be needed if Midnight is local, but Date.getTime() is UTC.
            // Assuming the series generation in SQL (timestamp with time zone) and JS match.
            // Simplest alignment: Round down to nearest interval from the base StartDate (Midnight)
            // But simplified: Round down to nearest interval modulus.

            // To be safe against timezone shifts, we align to the 'startDate' (Timezone aware midnight) we defined earlier
            const timeSinceStart = slotTime - startDate.getTime();
            const alignedOffset = Math.floor(timeSinceStart / intervalMs) * intervalMs;
            const alignedTime = new Date(startDate.getTime() + alignedOffset);

            const slotIsoKey = alignedTime.toISOString();

            let minAvailable = 0;
            // Direct lookup: The API now returns the correct 'min available' (bottleneck capacity) 
            // for the requested duration starting at this time.
            if (availabilityMap.has(slotIsoKey)) {
              minAvailable = availabilityMap.get(slotIsoKey) || 0;
            } else {
              // Fallback: If aligned key missing (e.g. due to slightly different TZ handling), try exact slot time
              const exactD = new Date(slot.dateTime);
              exactD.setSeconds(0, 0);
              if (availabilityMap.has(exactD.toISOString())) {
                minAvailable = availabilityMap.get(exactD.toISOString()) || 0;
              }
            }

            // Check if THIS slot overlaps with user's existing car reservations
            const duration = slot.duration || this.slotInterval || 60;
            const slotStart = slot.dateTime.getTime();
            const slotEnd = slotStart + (duration * 60000);

            let isReservedByThisCar = false;
            for (const res of this.userCarReservations) {
              const resStart = new Date(res.start_time).getTime();
              const resEnd = new Date(res.end_time).getTime();
              // Overlap check: (SlotStart < ResEnd) AND (SlotEnd > ResStart)
              if (slotStart < resEnd && slotEnd > resStart) {
                isReservedByThisCar = true;
                break;
              }
            }

            slot.isUserReserved = isReservedByThisCar;
            slot.remaining = isReservedByThisCar ? 0 : minAvailable;
            slot.originalRemaining = minAvailable;
            // ตรวจสอบว่ามีที่ว่างและยังไม่เลยเวลาปัจจุบัน และไม่ทับซ้อนกับรถตัวเอง
            slot.isAvailable = slot.remaining > 0 && slot.dateTime > new Date() && !isReservedByThisCar;
          });
        });

        // Update UI to reflect minimum availability for selected range
        this.updateSelectionUI();
      });
  }

  onSlotClick(slot: TimeSlot, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!slot.isAvailable) return;

    // --- REFINED SELECTION LOGIC ---
    if (this.bookingMode === 'daily') {
      // Range Selection for Daily
      // Case 0: No Selection -> Start New
      if (!this.startSlot || !this.endSlot) {
        this.startSlot = slot;
        this.endSlot = slot;
      }
      // Case 1: Single Slot Selected (Start == End)
      else if (this.startSlot.id === this.endSlot.id) {
        if (slot.id === this.startSlot.id) {
          // Clicked same slot -> Deselect (Reset)
          this.resetTimeSelection(false);
          return;
        } else {
          // Clicked different slot -> Form Range
          if (slot.dateTime.getTime() < this.startSlot.dateTime.getTime()) {
            // Clicked before -> Range is [Clicked, Start]
            const oldStart = this.startSlot;
            this.startSlot = slot;
            this.endSlot = oldStart;
          } else {
            // Clicked after -> Range is [Start, Clicked]
            this.endSlot = slot;
          }
        }
      }
      // Case 2: Range Selected (Start != End)
      else {
        // If clicked Start or End -> Reset (User Request)
        if (slot.id === this.startSlot.id || slot.id === this.endSlot.id) {
          this.resetTimeSelection(false);
          return;
        }
        else {
          // Clicked a new 3rd slot -> Start New Single Selection
          this.startSlot = slot;
          this.endSlot = slot;
        }
      }
    } else {
      // SINGLE SELECTION for Monthly, MonthlyNight, Flat24
      // Just click to select
      this.startSlot = slot;
      this.endSlot = slot; // Physically same slot, logic handles duration later
    }

    this.updateSelectionUI();

    // Generate Floor/Zone data if we have a valid range
    if (this.startSlot && this.endSlot) {
      this.loadAvailability();

      // Auto-Scroll removed
      // setTimeout(() => {
      //   const el = document.getElementById('location-section');
      //   if (el) {
      //     el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      //   }
      // }, 300);
    } else {
      this.floorData = [];
    }
  }



  updateSelectionUI() {
    let slotsInRange: TimeSlot[] = [];

    this.displayDays.forEach(day => {
      day.slots.forEach(s => {
        // 1. Restore original availability if available (to clear previous calculations)
        if (s.originalRemaining !== undefined) {
          s.remaining = s.originalRemaining;
        }

        // 2. Determine Selection State
        const isStart = !!this.startSlot && s.id === this.startSlot.id;
        const isEnd = !!this.endSlot && s.id === this.endSlot.id;
        s.isSelected = isStart || isEnd;

        // 3. Determine Range State
        if (this.startSlot && this.endSlot) {
          const sTime = s.dateTime.getTime();
          const startT = this.startSlot.dateTime.getTime();
          const endT = this.endSlot.dateTime.getTime();

          // Collect slots strictly within the selected range [Start, End] for min calculation
          // FIX: For continuous time ranges, the end slot marks the END of the booking period.
          // We should check slots from Start up to (but not including) End, OR include End if it's the only slot.
          // Currently UI treats EndSlot as the last INCLUSIVE 1-hour block if selection mode is range.
          // IF the user selects 9:00 and 10:00 (Range 9:00 - 11:00), we need 9:00 and 10:00 slots.
          // IF the user selects 9:00 only (Range 9:00 - 10:00), we need 9:00 slot.

          // Logic: Include slot if it falls within the range. 
          // Since our slots represent blocks (e.g. 9:00 is 9-10), we usually include start and end slots in the set.
          if (sTime >= startT && sTime <= endT) {
            slotsInRange.push(s);
          }

          // Visual In-Range flag (exclusive of start/end usually)
          s.isInRange = sTime > startT && sTime < endT;

          // Explicitly exclude start/end from in-range visual style
          if (isStart || isEnd) {
            s.isInRange = false;
          }
        } else {
          s.isInRange = false;
        }
      });
    });

    // 4. Calculate Minimum Availability in Range and Update Display
    if (slotsInRange.length > 0) {
      const minAvailable = Math.min(...slotsInRange.map(s => s.remaining));
      slotsInRange.forEach(s => {
        s.remaining = minAvailable;
      });
    }
  }

  // --- Mock Data Generation ---

  // --- Real Data Generation ---
  loadAvailability(preserveSelection: boolean = false) {
    // --- REAL DATA INTEGRATION ---
    if (!this.startSlot || !this.endSlot) return;

    // Loading State? (Optional interaction improvement)
    this.floorData = [];

    // Calculate accurate End Time (EndSlot Start + Duration)
    const endTime = new Date(this.endSlot.dateTime.getTime() + (this.endSlot.duration || 60) * 60000);

    this.parkingApiService.getAvailability(
      this.lot.id,
      this.startSlot.dateTime,
      endTime,
      this.selectedType // 'normal'/'car', 'ev', 'motorcycle' passed here
    ).subscribe({
      next: (data) => {
        console.log('Real Availability Data:', data);
        this.floorData = data; // API matches structure roughly

        // ✅ Update the selected slot's remaining count to match the SUM of floor availability
        // This ensures the "366" (daily avg) becomes "363" (actual range availability)
        const totalRangeAvailable = this.floorData.reduce((sum, f) => sum + (f.totalAvailable || 0), 0);

        if (this.startSlot && this.endSlot) {
          const startT = this.startSlot.dateTime.getTime();
          const endT = this.endSlot.dateTime.getTime();

          this.displayDays.forEach(day => {
            day.slots.forEach(s => {
              const sTime = s.dateTime.getTime();
              if (sTime >= startT && sTime <= endT) {
                s.remaining = totalRangeAvailable;
              }
            });
          });
        }

        // Default Select First Floor
        if (this.floorData.length > 0) {
          if (preserveSelection) {
            // Keep selection if possible
            const validFloors = this.selectedFloorIds.filter(id => this.floorData.some(f => f.id === id));
            if (validFloors.length > 0) {
              this.selectedFloorIds = validFloors;
            } else {
              // If previously selected floor is gone, select first
              this.selectedFloorIds = [this.floorData[0].id];
              this.clearAllZones(); // Reset zones if floor changed
            }
            this.updateDisplayZones();

            // Validate Zone Selection: If any selected zone is now FULL, deselect it.
            this.displayZones.forEach(z => {
              if (this.isZoneSelected(z.name) && z.status === 'full') {
                // Remove these IDs from selectedZoneIds
                this.selectedZoneIds = this.selectedZoneIds.filter(id => !z.ids.includes(id));
              }
            });
          } else {
            // Default Select First Floor (Reset)
            this.selectedFloorIds = [this.floorData[0].id];
            this.updateDisplayZones();
            this.clearAllZones();
          }
        }
      },
      error: (err) => {
        console.error('Error loading detailed availability', err);
        // Fallback or Toast?
      }
    });
  }

  // --- Floor Selection (Single) ---
  toggleFloor(floor: FloorData) {
    // Single Selection Mode: Always replace
    if (this.isFloorSelected(floor.id)) {
      // Optional: Allow deselecting if clicking the same one? 
      // User said "Select only one", implies radio behavior usually. 
      // But let's allow deselecting to be safe, or just keep it selected.
      // Let's allow deselecting for now.
      this.selectedFloorIds = [];
    } else {
      this.selectedFloorIds = [floor.id];
    }
    this.updateDisplayZones();
    this.clearAllZones();
  }

  selectAllFloors() {
    // Removed feature
  }

  clearAllFloors() {
    this.selectedFloorIds = [];
    this.updateDisplayZones();
    this.clearAllZones();
  }

  isFloorSelected(floorId: string): boolean {
    return this.selectedFloorIds.includes(floorId);
  }

  isAllFloorsSelected(): boolean {
    return false; // Feature removed
  }

  // --- Zone Aggregation Logic ---
  updateDisplayZones() {
    const aggMap = new Map<string, AggregatedZone>();

    this.selectedFloorIds.forEach(fid => {
      const floor = this.floorData.find(f => f.id === fid);
      if (floor) {
        floor.zones.forEach(z => {
          if (!aggMap.has(z.name)) {
            aggMap.set(z.name, {
              name: z.name,
              available: 0,
              capacity: 0,
              status: 'full',
              floorIds: [],
              ids: []
            });
          }
          const agg = aggMap.get(z.name)!;
          agg.available += z.available;
          agg.capacity += z.capacity;
          agg.floorIds.push(fid);
          agg.ids.push(z.id);

          if (agg.available > 0) agg.status = 'available';
        });
      }
    });

    this.displayZones = Array.from(aggMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- Zone Selection (Single) ---
  toggleZone(aggZone: AggregatedZone) {
    const isSelected = this.isZoneSelected(aggZone.name);

    if (isSelected) {
      this.selectedZoneIds = [];
    } else {
      // Single Selection: Replace all
      this.selectedZoneIds = [...aggZone.ids];
    }
  }

  isZoneSelected(aggZoneName: string): boolean {
    const aggZone = this.displayZones.find(z => z.name === aggZoneName);
    if (!aggZone) return false;
    return aggZone.ids.length > 0 && aggZone.ids.every(id => this.selectedZoneIds.includes(id));
  }

  selectAllZones() {
    // Removed
  }

  clearAllZones() {
    this.selectedZoneIds = [];
  }

  isAllZonesSelected(): boolean {
    return false;
  }

  get selectedZonesCount(): number {
    return this.displayZones.filter(z => this.isZoneSelected(z.name)).length;
  }

  // --- General ---
  selectSite(site: ParkingLot) {
    console.log('--- [ParkingDetail] Switching Site ---');
    console.log('New Site:', site.name, site.id);
    console.log('Full Site Data:', site);

    this.lot = site;
    if (this.lot.supportedTypes.length > 0 && !this.lot.supportedTypes.includes(this.selectedType)) {
      this.selectedType = this.lot.supportedTypes[0];
    }
    this.checkOpenStatus();
    this.generateWeeklySchedule();
    this.resetTimeSelection();
    // Ensure we start fresh
    this.selectedDateIndex = 0;
    this.generateTimeSlots();

    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();
  }

  selectType(type: string) {
    this.selectedType = type;
    this.resetTimeSelection();
    this.generateTimeSlots();

    // Dismiss popovers
    const popovers = document.querySelectorAll('ion-popover');
    popovers.forEach((p: any) => p.dismiss());

    this.cdr.detectChanges();
  }

  async selectBookingMode(mode: 'daily' | 'monthly' | 'flat24') {
    // 1. Dismiss any open popovers immediately
    const popovers = document.querySelectorAll('ion-popover');
    if (popovers.length > 0) {
      await Promise.all(Array.from(popovers).map((p: any) => p.dismiss()));
    }

    // 2. Update Mode
    this.bookingMode = mode;
    this.crossDayCount = 1;
    this.displayDays = []; // Clear immediately to prevent stale UI

    // 3. Reset State Forcefully
    this.resetTimeSelection(true);

    // Set default interval based on mode to prevent stale state
    if (this.bookingMode === 'daily' || this.bookingMode === 'flat24') {
      this.slotInterval = 60; // Default 1 hour
    } else {
      this.slotInterval = -1; // Full/fixed for other modes usually
    }

    // 4. Force Regenerate with Delay to ensure UI cleans up
    setTimeout(() => {
      this.generateTimeSlots();
      this.updateSelectionUI();
    }, 50); // Small delay to allow DOM to react to mode change
  }

  // --- Single Line Summary ---
  // --- Single Line Summary ---
  get singleLineSummary(): string {
    if (!this.startSlot || !this.endSlot) return '';

    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const sDate = this.startSlot.dateTime;

    // --- ADAPTED SUMMARY FOR MODES ---
    if (this.bookingMode === 'monthly') {
      // Monthly: Show Start - End Date same as Logic
      // Logic: Start -> Start + 1 Month
      const eDate = new Date(sDate);
      eDate.setMonth(sDate.getMonth() + 1);

      const sDateStr = `${sDate.getDate()} ${thaiMonths[sDate.getMonth()]}`; // Short Year?
      // User Example: "11 ม.ค. - 11 ก.พ."
      // If Cross Year? "11 ธ.ค. - 11 ม.ค."
      const eDateStr = `${eDate.getDate()} ${thaiMonths[eDate.getMonth()]}`;

      return `ใช้งานได้ ${sDateStr} - ${eDateStr} (${this.getModeLabel()})`;
    }

    if (this.bookingMode === 'flat24') {
      const sDateStr = `${sDate.getDate()} ${thaiMonths[sDate.getMonth()]}`;
      const sTimeStr = `${this.pad(sDate.getHours())}:${this.pad(sDate.getMinutes())}`;
      return `เริ่ม ${sDateStr} ${sTimeStr} (+24 ชม.) | ${this.getModeLabel()}`;
    }

    const sDateStr = `${sDate.getDate()} ${thaiMonths[sDate.getMonth()]}`;
    const sTimeStr = `${this.pad(sDate.getHours())}:${this.pad(sDate.getMinutes())}`;

    const eSlotVal = this.endSlot;
    const duration = eSlotVal.duration || this.slotInterval || 60;
    const eDate = new Date(eSlotVal.dateTime.getTime() + duration * 60000);

    let datePart = '';

    if (sDate.getDate() !== eDate.getDate()) {
      // Cross Day: "13 ม.ค. 19:00 - 14 ม.ค. 08:00"
      const eDateStr = `${eDate.getDate()} ${thaiMonths[eDate.getMonth()]}`;
      const eTimeStr = `${this.pad(eDate.getHours())}:${this.pad(eDate.getMinutes())}`;
      datePart = `${sDateStr} ${sTimeStr} - ${eDateStr} ${eTimeStr}`;
    } else {
      // Single Day: "13 ม.ค. 19:00 - 20:00"
      const eTimeStr = `${this.pad(eDate.getHours())}:${this.pad(eDate.getMinutes())}`;
      datePart = `${sDateStr} ${sTimeStr} - ${eTimeStr}`;
    }

    // Location Part
    if (this.selectedFloorIds.length === 0) return datePart;

    const fNames = this.floorData.filter(f => this.selectedFloorIds.includes(f.id)).map(f => f.name.replace('Floor', 'F').replace(' ', '')).join(', ');
    let zNames = '';
    if (this.selectedZonesCount > 0) {
      zNames = this.displayZones.filter(z => this.isZoneSelected(z.name)).map(z => z.name.replace('Zone ', '')).join(', ');
    } else {
      zNames = '-';
    }

    return `${datePart} | ชั้น ${fNames} Zone ${zNames}`;
  }

  getModeLabel(): string {
    switch (this.bookingMode) {
      case 'monthly': return 'รายเดือน';

      case 'flat24': return 'เหมา 24 ชม.';
      default: return 'รายชั่วโมง';
    }
  }

  get locationSummary(): string {
    if (this.selectedFloorIds.length === 0) return '';

    const fNames = this.floorData.filter(f => this.selectedFloorIds.includes(f.id)).map(f => f.name.replace('Floor', 'F').replace(' ', '')).join(', ');

    let zNames = '';
    if (this.selectedZonesCount > 0) {
      zNames = this.displayZones.filter(z => this.isZoneSelected(z.name)).map(z => z.name.replace('Zone ', '')).join(', ');
    } else {
      zNames = '-';
    }
    return `ชั้น ${fNames} | Zone ${zNames}`;
  }

  async Reservations() {
    if (!this.startSlot || !this.endSlot) {
      this.presentToast('กรุณาเลือกเวลา');
      return;
    }

    // Validate Zone Selection
    if (this.selectedZoneIds.length === 0) {
      this.presentToast('กรุณาเลือกโซน');
      return;
    }

    // --- Vehicle Check ---
    this.parkingDataService.vehicles$.pipe(take(1)).subscribe(async (vehicles) => {
      if (!vehicles || vehicles.length === 0) {
        // No vehicles, show Add Vehicle modal
        const addModal = await this.modalCtrl.create({
          component: AddVehicleModalComponent,
          breakpoints: [0, 1],
          initialBreakpoint: 1,
        });
        await addModal.present();

        const { data, role } = await addModal.onDidDismiss();
        if (role === 'confirm' && data) {
          try {
            await this.parkingDataService.addVehicle(data);
            const userId = this.reservationService.getCurrentProfileId();
            await this.parkingDataService.loadUserVehicles(userId);
            this.processBooking();
          } catch (e: any) {
            console.error('Error adding vehicle', e);
            const msg = e.message === 'รถป้ายทะเบียนนี้มีอยู่ในระบบแล้ว'
              ? e.message
              : 'เกิดข้อผิดพลาดในการเพิ่มรถ';
            this.presentToast(msg);
          }
        }
      } else {
        // User has at least 1 vehicle, proceed to booking processing
        this.processBooking();
      }
    });
  }

  private async processBooking() {
    if (!this.startSlot || !this.endSlot) return; // TS guard

    // --- LOGIC FOR BOOKING MODES ---
    let finalStart = new Date(this.startSlot.dateTime);
    let finalEnd = new Date(this.endSlot.dateTime);

    if (this.bookingMode === 'monthly') {
      finalEnd = new Date(finalStart);
      finalEnd.setMonth(finalStart.getMonth() + 1);
      finalStart.setHours(0, 0, 0, 0);
      finalEnd.setHours(23, 59, 59, 999);
    }

    else if (this.bookingMode === 'flat24') {
      finalEnd = new Date(finalStart.getTime() + (24 * 60 * 60 * 1000));
    } else {
      // Daily Mode: Use exact duration from endSlot for both single and range selections
      const duration = this.endSlot.duration || 60;
      finalEnd = new Date(this.endSlot.dateTime.getTime() + (duration * 60000));
    }

    let data: any = {
      siteId: this.lot.id.split('-')[0],
      siteName: this.lot.name,
      selectedType: this.selectedType,
      selectedFloors: this.selectedFloorIds,
      selectedZones: this.displayZones.filter(z => this.isZoneSelected(z.name)).map(z => z.name),
      selectedZoneIds: this.selectedZoneIds,
      startSlot: { ...this.startSlot, dateTime: finalStart },
      endSlot: { ...this.endSlot, dateTime: finalEnd },
      isSpecificSlot: true,
      isRandomSystem: false,
      bookingMode: this.bookingMode,
      lotPrice: this.lot?.price !== undefined ? this.lot.price : 20,
      price: this.calculatePrice(finalStart, finalEnd)
    };

    try {
      const modal = await this.modalCtrl.create({
        component: CheckBookingComponent,
        componentProps: {
          data: { ...data }
        },
        initialBreakpoint: 1,
        breakpoints: [0, 0.5, 1],
        backdropDismiss: true,
        cssClass: 'detail-sheet-modal',
      });
      await modal.present();

      const { data: result, role } = await modal.onDidDismiss();
      if (role === 'confirm' && result && result.confirmed) {
        // Show loading indicator
        const loading = await this.loadingCtrl.create({
          message: 'กำลังดำเนินการจอง...',
          spinner: 'crescent',
          cssClass: 'custom-loading'
        });
        await loading.present();
        this.isBooking = true;

        const bookingData = result.data;
        const newBooking: Booking = {
          id: 'BK-' + new Date().getTime(),
          placeName: bookingData.siteName,
          locationDetails: `ชั้น ${bookingData.selectedFloors[0]} | โซน ${bookingData.selectedZones[0]} | ${bookingData.selectedSlotId}`,
          bookingTime: bookingData.startSlot.dateTime,
          endTime: bookingData.endSlot.dateTime,
          status: bookingData.status,
          price: bookingData.price || bookingData.totalPrice,
          carBrand: 'N/A',
          licensePlate: bookingData.car_plate || '-',
          bookingType: bookingData.bookingMode || 'daily',
          carId: bookingData.car_id
        };

        this.parkingDataService.addBooking(newBooking);

        try {
          await this.reservationService.createReservationv2(
            newBooking,
            this.reservationService.getCurrentProfileId(),
            bookingData.siteId,
            bookingData.selectedFloors[0],
            bookingData.selectedSlotId
          );

          // Hide loading
          await loading.dismiss();
          this.isBooking = false;

          // Trigger Data Refresh
          this.uiEventService.triggerRefreshParkingData();

          // Show success modal with complete data
          const successData = {
            ...newBooking,
            selectedSlotId: bookingData.selectedSlotId,
            selectedFloors: bookingData.selectedFloors,
            selectedZones: bookingData.selectedZones,
            siteName: bookingData.siteName,
            startSlot: bookingData.startSlot,
            endSlot: bookingData.endSlot
          };
          await this.showSuccessModal(successData);

        } catch (e: any) {
          // Hide loading
          await loading.dismiss();
          this.isBooking = false;

          console.error('Reservation Failed', e);

          // Show detailed error
          await this.showErrorAlert(e);
        }
      }

    } catch (err) {
      console.error('Error showing booking modal', err);
      this.isBooking = false;
    }
  }

  calculatePrice(start: Date, end: Date): number {
    const timeDiffRaw = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const hours = Math.max(1, Math.ceil(timeDiffRaw));
    
    const hourlyRate = this.lot?.price !== undefined ? this.lot.price : 20;
    
    if (this.bookingMode === 'monthly') return 1500; // Mock monthly rate
    if (this.bookingMode === 'flat24') return hourlyRate * 10; // e.g. cap at 10 hours for flat24
    return hours * hourlyRate;
  }

  // Helpers
  onImageScroll(event: any) {
    const scrollLeft = event.target.scrollLeft;
    const width = event.target.offsetWidth;
    this.currentImageIndex = Math.round(scrollLeft / width);
  }

  pad(num: number): string { return num < 10 ? '0' + num : num.toString(); }
  dismiss() { this.modalCtrl.dismiss(); }
  checkOpenStatus() {
    this.todayCloseTime = '';
    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = days[now.getDay()];

    let openH = 8, openM = 0;
    let closeH = 20, closeM = 0;
    let isTodayClosed = false;

    // 1. Determine Hours
    if (this.lot && this.lot.schedule && this.lot.schedule.length > 0) {
      // Have schedule data
      const todaySchedule = this.lot.schedule.find(s => s.days.includes(currentDayName));
      if (todaySchedule) {
        [openH, openM] = todaySchedule.open_time.split(':').map(Number);
        [closeH, closeM] = todaySchedule.close_time.split(':').map(Number);
        this.todayCloseTime = todaySchedule.close_time.slice(0, 5);
      } else {
        // Schedule exists but not for today -> Closed
        isTodayClosed = true;
      }
    } else {
      // No schedule -> Fallback to 24 Hours
      openH = 0; openM = 0;
      closeH = 24; closeM = 0;
      this.todayCloseTime = '24:00';
    }

    // 2. Check Open Status
    if (isTodayClosed) {
      this.isOpenNow = false;
      this.todayCloseTime = ''; // Closed
    } else {
      const openTime = new Date(now);
      openTime.setHours(openH, openM, 0, 0);

      const closeTime = new Date(now);

      // Handle 24:00 (Next Day 00:00)
      if (closeH === 24) {
        closeTime.setDate(closeTime.getDate() + 1);
        closeTime.setHours(0, 0, 0, 0);
      } else {
        closeTime.setHours(closeH, closeM, 0, 0);
      }

      this.isOpenNow = now >= openTime && now < closeTime;
    }
  }

  getCurrentCapacity(): number { return (this.lot?.capacity as any)?.[this.selectedType] || 0; }
  getCurrentAvailable(): number { return (this.lot?.available as any)?.[this.selectedType] || 0; }
  getTypeName(type: string): string {
    switch (type) {
      case 'normal': return 'รถทั่วไป';
      case 'ev': return 'รถ EV';
      case 'motorcycle': return 'มอเตอร์ไซค์';
      default: return type;
    }
  }

  generateWeeklySchedule() {
    const today = new Date().getDay();
    const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    this.weeklySchedule = [];

    for (let i = 0; i < 7; i++) {
      const dayIndex = (today + i) % 7;
      const dayKey = dayKeys[dayIndex];

      let timeRange = 'ปิดบริการ';

      if (this.lot && this.lot.schedule) {
        const schedule = this.lot.schedule.find(s => s.days.includes(dayKey));
        if (schedule) {
          timeRange = `${schedule.open_time.slice(0, 5)} - ${schedule.close_time.slice(0, 5)}`;
        }
      }

      this.weeklySchedule.push({
        dayName: dayNames[dayIndex],
        timeRange: timeRange,
        isToday: i === 0
      });
    }
  }

  async presentToast(message: string) {
    const toast = await this.toastCtrl.create({
      message: message, duration: 2000, color: 'danger', position: 'top',
    });
    toast.present();
  }

  async showSuccessModal(bookingData: any) {
    const modal = await this.modalCtrl.create({
      component: BookingSuccessModalComponent,
      componentProps: {
        bookingData: bookingData
      },
      backdropDismiss: true,
      cssClass: 'success-modal'
    });
    await modal.present();
  }

  async showErrorAlert(error: any) {
    let errorTitle = 'เกิดข้อผิดพลาด';
    let errorMessage = 'ไม่สามารถดำเนินการจองได้ กรุณาลองใหม่อีกครั้ง';
    let errorButtons: any[] = ['ตกลง'];

    // Extract clean message (remove error code prefix like "USER_BLACKLISTED: ...")
    const rawMessage: string = error.message || '';
    const cleanMessage = rawMessage.includes(':') ? rawMessage.substring(rawMessage.indexOf(':') + 1).trim() : rawMessage;

    // Determine error type and customize message
    if (rawMessage.includes('USER_BLACKLISTED')) {
      errorTitle = 'ไม่สามารถจองได้';
      errorMessage = cleanMessage || 'คุณถูกระงับการใช้งานการจอง กรุณาติดต่อเจ้าหน้าที่';
    } else if (rawMessage.includes('SLOT_NOT_AVAILABLE') || rawMessage.includes('already booked')) {
      errorTitle = 'ช่องจอดเต็มแล้ว';
      errorMessage = cleanMessage || 'ขออภัย ช่องจอดนี้เพิ่งมีผู้จองไปแล้ว กรุณาเลือกช่องจอดอื่นหรือเวลาอื่น';
      errorButtons = [
        {
          text: 'เลือกใหม่',
          role: 'cancel'
        }
      ];
    } else if (error.code === '23P01' || rawMessage.includes('Double Booking') || rawMessage.includes('DOUBLE_BOOKING')) {
      errorTitle = 'มีการจองซ้ำ';
      errorMessage = cleanMessage || 'มีการจองช่องนี้ในเวลาที่ทับซ้อนกันแล้ว กรุณาเลือกช่องใหม่';
    } else if (rawMessage.includes('network') || rawMessage.includes('fetch') || error.status === 0) {
      errorTitle = 'ไม่สามารถเชื่อมต่อได้';
      errorMessage = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตและลองใหม่อีกครั้ง';
      errorButtons = [
        {
          text: 'ยกเลิก',
          role: 'cancel'
        }
      ];
    } else if (rawMessage && !rawMessage.includes('non-2xx status code')) {
      errorMessage = rawMessage;
    }

    const alert = await this.alertCtrl.create({
      header: errorTitle,
      message: errorMessage,
      buttons: errorButtons,
      cssClass: 'error-alert'
    });

    await alert.present();
  }

  // --- Map Navigation ---
  openMap(lat?: number, lng?: number) {
    if (!lat || !lng) {
      console.warn('Coordinates not available for this location.');
      return;
    }

    // Always use Google Maps
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  }
}