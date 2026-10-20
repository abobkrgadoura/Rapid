"use client";

import { useEffect, useRef, useState } from "react";
import Form from "next/form";
import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeftRight, MapPin, Minus, Package, PackagePlus, Plus, StickyNote, Undo2, UserRound, Wallet } from "lucide-react";

import { createMerchantOrder } from "@/actions/orders";
import { useLocale } from "@/components/i18n/locale-context";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toastError } from "@/components/ui/toast";
import type { MerchantOrderDefaults } from "@/lib/data/merchant-order-defaults";
import type { Messages } from "@/lib/i18n/messages";
import {
  createOrderState,
  type CreateOrderField,
  type CreateOrderValues,
  type OrderIntent,
} from "@/lib/orders/create-order";
import { PARCEL_SIZES } from "@/lib/orders/shipment-details";
import { cn } from "@/lib/utils";

function invalid(
  errors: Partial<Record<CreateOrderField, string>>,
  field: CreateOrderField,
) {
  return errors[field] ? true : undefined;
}

export function OrderIntentHeader({ intent }: { intent: OrderIntent }) {
  const { m } = useLocale();
  const copy = m.orderForm.intents[intent];
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">{copy.body}</p>
    </div>
  );
}

export function CreateOrderForm({
  defaults,
  intent,
}: {
  defaults: MerchantOrderDefaults;
  intent: OrderIntent;
}) {
  const { locale, m } = useLocale();
  const copy = m.orderForm;
  const [state, action, pending] = useActionState(
    createMerchantOrder,
    createOrderState(defaults),
  );
  const { values, errors } = state;
  const fresh = state.attempt === 0;
  const customer = {
    customerName: fresh ? "" : values.customerName,
    phone: fresh ? "" : values.phone,
    secondaryPhone: fresh ? "" : values.secondaryPhone,
    dropoffAddress: fresh ? "" : values.dropoffAddress,
    dropoffGpsUrl: fresh ? "" : values.dropoffGpsUrl,
    pickupAddress: fresh ? "" : values.pickupAddress,
  };
  const toastedAttempt = useRef(0);

  useEffect(() => {
    if (state.attempt === 0 || toastedAttempt.current === state.attempt) return;
    toastedAttempt.current = state.attempt;
    const firstFieldError = Object.values(errors).find(Boolean);
    toastError(state.formError ?? copy.review, state.formError ? undefined : firstFieldError);
  }, [state.attempt, state.formError, errors, copy.review]);

  return (
    <Form
      action={action}
      key={state.attempt}
      autoComplete="off"
      data-intent={intent}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="locale" value={locale} />

      {intent === "return" ? (
        <ReturnFields
          copy={copy}
          pending={pending}
          errors={errors}
          customer={customer}
          tracking={fresh ? "" : values.originalTracking}
          pickupGps={fresh ? "" : values.pickupGpsUrl}
          dropoff={fresh ? defaults.returnAddress : values.dropoffAddress}
          dropoffLocked={defaults.returnAddress.trim().length >= 4}
          values={values}
        />
      ) : null}

      {intent === "exchange" ? (
        <ExchangeFields
          copy={copy}
          defaults={defaults}
          pending={pending}
          errors={errors}
          values={values}
          customer={customer}
        />
      ) : null}

      {intent === "delivery" ? (
        <DeliveryFields
          copy={copy}
          defaults={defaults}
          pending={pending}
          errors={errors}
          values={values}
          customer={customer}
        />
      ) : null}

      <ParcelDetails copy={copy} pending={pending} errors={errors} values={values} />
      <OrderNotes copy={copy} pending={pending} errors={errors} values={values} />

      <PaymentFields
        copy={copy}
        pending={pending}
        errors={errors}
        values={values}
      />

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="brand"
        size="lg"
        disabled={pending}
        className="h-12 w-full text-base font-bold"
      >
        {pending ? copy.submitting : copy.submit}
      </Button>
    </Form>
  );
}

type Copy = Messages["orderForm"];
type Errors = Partial<Record<CreateOrderField, string>>;
type CustomerDraft = {
  customerName: string;
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
  dropoffGpsUrl: string;
  pickupAddress: string;
};

function DeliveryFields({
  copy,
  defaults,
  pending,
  errors,
  values,
  customer,
}: {
  copy: Copy;
  defaults: MerchantOrderDefaults;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
  customer: CustomerDraft;
}) {
  return (
    <>
      <MerchantPickup
        copy={copy}
        defaults={defaults}
        pending={pending}
        errors={errors}
        values={values}
      />
      <ReturnLocation
        copy={copy}
        defaults={defaults}
        pending={pending}
        errors={errors}
        value={values.returnAddress}
      />
      <Section
        icon={UserRound}
        title={copy.customerTitle}
        tone="customer"
        description={copy.customerDescription}
      >
        <CustomerIdentity copy={copy} pending={pending} errors={errors} customer={customer} />
        <CustomerAddress
          copy={copy}
          pending={pending}
          errors={errors}
          address={customer.dropoffAddress}
          map={customer.dropoffGpsUrl}
          addressLabel={copy.customerAddress}
          values={values}
        />
      </Section>
    </>
  );
}

function ReturnFields({
  copy,
  pending,
  errors,
  customer,
  tracking,
  pickupGps,
  dropoff,
  dropoffLocked,
  values,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  customer: CustomerDraft;
  tracking: string;
  pickupGps: string;
  dropoff: string;
  dropoffLocked: boolean;
  values: CreateOrderValues;
}) {
  return (
    <>
      <Section
        icon={Undo2}
        title={copy.originalTracking}
        tone="return"
        description={copy.originalTrackingHint}
      >
        <Field data-invalid={invalid(errors, "originalTracking")}>
          <FieldLabel htmlFor="originalTracking">{copy.originalTracking}</FieldLabel>
          <Input
            id="originalTracking"
            name="originalTracking"
            autoComplete="off"
            required
            dir="ltr"
            disabled={pending}
            defaultValue={tracking}
            aria-invalid={invalid(errors, "originalTracking")}
            placeholder="RP3F9A21C0"
            className="h-11 text-start sm:max-w-sm"
          />
          {errors.originalTracking ? <FieldError>{errors.originalTracking}</FieldError> : null}
        </Field>
      </Section>

      <Section
        icon={UserRound}
        title={copy.customerPickupTitle}
        tone="customer"
        description={copy.customerPickupDescription}
      >
        <CustomerIdentity copy={copy} pending={pending} errors={errors} customer={customer} />
        <Field data-invalid={invalid(errors, "pickupAddress")}>
          <FieldLabel htmlFor="pickupAddress">{copy.customerPickupAddress}</FieldLabel>
          <Input
            id="pickupAddress"
            name="pickupAddress"
            autoComplete="off"
            required
            disabled={pending}
            defaultValue={customer.pickupAddress}
            aria-invalid={invalid(errors, "pickupAddress")}
            className="h-11"
          />
          {errors.pickupAddress ? <FieldError>{errors.pickupAddress}</FieldError> : null}
        </Field>
        <SecondaryAddress copy={copy} pending={pending} errors={errors} values={values} />
        <MapField
          id="pickupGpsUrl"
          label={copy.mapOptional}
          pending={pending}
          defaultValue={pickupGps}
          error={errors.pickupGpsUrl}
        />
      </Section>

      <Section
        icon={MapPin}
        title={copy.dropoffTitle}
        hint={copy.returnHint}
        tone="saved"
        description={copy.dropoffDescription}
      >
        <Field data-invalid={invalid(errors, "dropoffAddress")}>
          <FieldLabel htmlFor="dropoffAddress">{copy.dropoffAddress}</FieldLabel>
          <Input
            id="dropoffAddress"
            name="dropoffAddress"
            autoComplete="off"
            required
            readOnly={dropoffLocked}
            disabled={pending}
            defaultValue={dropoff}
            aria-invalid={invalid(errors, "dropoffAddress")}
            className={cn("h-11", dropoffLocked && "bg-muted")}
          />
          <FieldDescription>
            {dropoffLocked ? (
              <>
                {copy.dropoffLocked}{" "}
                <Link href="/merchant/settings" className="text-brand font-medium hover:underline">
                  {copy.edit}
                </Link>
              </>
            ) : (
              copy.dropoffDescription
            )}
          </FieldDescription>
          {errors.dropoffAddress ? <FieldError>{errors.dropoffAddress}</FieldError> : null}
        </Field>
      </Section>
    </>
  );
}

function ExchangeFields({
  copy,
  defaults,
  pending,
  errors,
  values,
  customer,
}: {
  copy: Copy;
  defaults: MerchantOrderDefaults;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
  customer: CustomerDraft;
}) {
  const returnLocked = defaults.returnAddress.trim().length >= 4;
  return (
    <>
      <MerchantPickup
        copy={copy}
        defaults={defaults}
        pending={pending}
        errors={errors}
        values={values}
      />
      <Section
        icon={UserRound}
        title={copy.customerTitle}
        tone="customer"
        description={copy.customerDescription}
      >
        <CustomerIdentity copy={copy} pending={pending} errors={errors} customer={customer} />
      </Section>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section
          icon={PackagePlus}
          title={copy.newShipment}
          tone="customer"
          description={copy.newShipmentDescription}
        >
          <NoteField
            id="newItemNote"
            label={copy.newItem}
            pending={pending}
            defaultValue={values.newItemNote}
            error={errors.newItemNote}
          />
          <CustomerAddress
            copy={copy}
            pending={pending}
            errors={errors}
            address={customer.dropoffAddress}
            map={customer.dropoffGpsUrl}
            addressLabel={copy.customerAddress}
            values={values}
          />
        </Section>
        <Section
          icon={ArrowLeftRight}
          title={copy.returnShipment}
          tone="return"
          description={copy.returnShipmentDescription}
        >
          <NoteField
            id="returnItemNote"
            label={copy.returnItem}
            pending={pending}
            defaultValue={values.returnItemNote}
            error={errors.returnItemNote}
          />
          <Field data-invalid={invalid(errors, "returnAddress")}>
            <FieldLabel htmlFor="returnAddress">{copy.returnAddress}</FieldLabel>
            <Input
              id="returnAddress"
              name="returnAddress"
              autoComplete="off"
              readOnly={returnLocked}
              disabled={pending}
              defaultValue={values.returnAddress}
              aria-invalid={invalid(errors, "returnAddress")}
              placeholder={copy.returnPlaceholder}
              className={cn("h-11", returnLocked && "bg-muted")}
            />
            {errors.returnAddress ? <FieldError>{errors.returnAddress}</FieldError> : null}
          </Field>
        </Section>
      </div>
    </>
  );
}

function MerchantPickup({
  copy,
  defaults,
  pending,
  errors,
  values,
}: {
  copy: Copy;
  defaults: MerchantOrderDefaults;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
}) {
  const pickupLocked = defaults.pickupAddress.trim().length >= 4;
  return (
    <Section
      icon={MapPin}
      title={copy.pickupTitle}
      hint={copy.pickupHint}
      tone="saved"
      description={copy.pickupDescription}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadonlyFact label={copy.merchantName} value={defaults.merchantName} missing={copy.missingPlaceholder} settings={copy.addInSettings} />
          <ReadonlyFact label={copy.merchantPhone} value={defaults.phone} ltr missing={copy.missingPlaceholder} settings={copy.addInSettings} />
        </div>
        <Field data-invalid={invalid(errors, "pickupAddress")}>
          <FieldLabel htmlFor="pickupAddress">{copy.pickupAddress}</FieldLabel>
          <Input
            id="pickupAddress"
            name="pickupAddress"
            autoComplete="off"
            required
            readOnly={pickupLocked}
            disabled={pending}
            defaultValue={values.pickupAddress}
            aria-invalid={invalid(errors, "pickupAddress")}
            placeholder="السوق العربي، أم درمان، ولاية الخرطوم"
            className={cn("h-11", pickupLocked && "bg-muted")}
          />
          <FieldDescription>
            {pickupLocked ? (
              <>
                {copy.pickupLocked}{" "}
                <Link href="/merchant/settings" className="text-brand font-medium hover:underline">
                  {copy.edit}
                </Link>
              </>
            ) : (
              copy.pickupOnce
            )}
          </FieldDescription>
          {errors.pickupAddress ? <FieldError>{errors.pickupAddress}</FieldError> : null}
        </Field>
        <MapField
          id="pickupGpsUrl"
          label={copy.mapOptional}
          pending={pending}
          defaultValue={values.pickupGpsUrl}
          error={errors.pickupGpsUrl}
        />
      </FieldGroup>
    </Section>
  );
}

function ReturnLocation({
  copy,
  defaults,
  pending,
  errors,
  value,
}: {
  copy: Copy;
  defaults: MerchantOrderDefaults;
  pending: boolean;
  errors: Errors;
  value: string;
}) {
  const returnLocked = defaults.returnAddress.trim().length >= 4;
  return (
    <Section
      icon={Undo2}
      title={copy.returnTitle}
      hint={copy.returnHint}
      tone="return"
      description={copy.returnDescription}
    >
      <Field data-invalid={invalid(errors, "returnAddress")}>
        <FieldLabel htmlFor="returnAddress">{copy.returnAddress}</FieldLabel>
        <Input
          id="returnAddress"
          name="returnAddress"
          autoComplete="off"
          readOnly={returnLocked}
          disabled={pending}
          defaultValue={value}
          aria-invalid={invalid(errors, "returnAddress")}
          placeholder={copy.returnPlaceholder}
          className={cn("h-11", returnLocked && "bg-muted")}
        />
        {errors.returnAddress ? <FieldError>{errors.returnAddress}</FieldError> : null}
      </Field>
    </Section>
  );
}

function CustomerIdentity({
  copy,
  pending,
  errors,
  customer,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  customer: CustomerDraft;
}) {
  return (
    <FieldGroup data-customer-fields="blank">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={invalid(errors, "customerName")}>
          <FieldLabel htmlFor="customerName">{copy.customerName}</FieldLabel>
          <Input
            id="customerName"
            name="customerName"
            autoComplete="off"
            required
            disabled={pending}
            defaultValue={customer.customerName}
            aria-invalid={invalid(errors, "customerName")}
            className="h-11"
          />
          {errors.customerName ? <FieldError>{errors.customerName}</FieldError> : null}
        </Field>
        <Field data-invalid={invalid(errors, "phone")}>
          <FieldLabel htmlFor="customerPhone">{copy.customerPhone}</FieldLabel>
          <Input
            id="customerPhone"
            name="customerPhone"
            type="tel"
            dir="ltr"
            autoComplete="off"
            required
            disabled={pending}
            defaultValue={customer.phone}
            aria-invalid={invalid(errors, "phone")}
            placeholder={copy.phonePlaceholder}
            className="h-11 text-start"
          />
          {errors.phone ? <FieldError>{errors.phone}</FieldError> : null}
        </Field>
      </div>
      <Field data-invalid={invalid(errors, "secondaryPhone")}>
        <FieldLabel htmlFor="customerSecondaryPhone">{copy.secondaryPhone}</FieldLabel>
        <Input
          id="customerSecondaryPhone"
          name="customerSecondaryPhone"
          type="tel"
          dir="ltr"
          autoComplete="off"
          disabled={pending}
          defaultValue={customer.secondaryPhone}
          aria-invalid={invalid(errors, "secondaryPhone")}
          placeholder={copy.phonePlaceholder}
          className="h-11 text-start sm:max-w-[calc(50%-0.5rem)]"
        />
        <FieldDescription>{copy.secondaryHint}</FieldDescription>
        {errors.secondaryPhone ? <FieldError>{errors.secondaryPhone}</FieldError> : null}
      </Field>
    </FieldGroup>
  );
}

function CustomerAddress({
  copy,
  pending,
  errors,
  address,
  map,
  addressLabel,
  values,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  address: string;
  map: string;
  addressLabel: string;
  values: CreateOrderValues;
}) {
  return (
    <FieldGroup>
      <Field data-invalid={invalid(errors, "dropoffAddress")}>
        <FieldLabel htmlFor="dropoffAddress">{addressLabel}</FieldLabel>
        <Input
          id="dropoffAddress"
          name="dropoffAddress"
          autoComplete="off"
          required
          disabled={pending}
          defaultValue={address}
          aria-invalid={invalid(errors, "dropoffAddress")}
          className="h-11"
        />
        {errors.dropoffAddress ? <FieldError>{errors.dropoffAddress}</FieldError> : null}
      </Field>
      <SecondaryAddress copy={copy} pending={pending} errors={errors} values={values} />
      <MapField
        id="dropoffGpsUrl"
        label={copy.customerMap}
        hint={copy.customerMapHint}
        pending={pending}
        defaultValue={map}
        error={errors.dropoffGpsUrl}
      />
    </FieldGroup>
  );
}

function SecondaryAddress({
  copy,
  pending,
  errors,
  values,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
}) {
  const [open, setOpen] = useState(
    Boolean(
      values.buildingName ||
        values.floorNumber ||
        values.apartmentNumber ||
        values.landmark ||
        values.isWorkAddress,
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="text-brand w-fit text-sm font-semibold hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? copy.secondaryHide : copy.secondaryToggle}
      </button>
      <div className={cn("grid gap-4 sm:grid-cols-2", !open && "hidden")}>
          <OptionalLine
            id="buildingName"
            label={copy.buildingName}
            pending={pending}
            defaultValue={values.buildingName}
            error={errors.buildingName}
            maxLength={80}
          />
          <OptionalLine
            id="floorNumber"
            label={copy.floorNumber}
            pending={pending}
            defaultValue={values.floorNumber}
            error={errors.floorNumber}
            maxLength={20}
          />
          <OptionalLine
            id="apartmentNumber"
            label={copy.apartmentNumber}
            pending={pending}
            defaultValue={values.apartmentNumber}
            error={errors.apartmentNumber}
            maxLength={20}
          />
          <OptionalLine
            id="landmark"
            label={copy.landmark}
            pending={pending}
            defaultValue={values.landmark}
            error={errors.landmark}
            maxLength={120}
          />
          <label className="border-input has-[:checked]:border-brand flex items-center gap-2 rounded-xl border px-4 py-3 sm:col-span-2">
            <input
              type="checkbox"
              name="isWorkAddress"
              value="yes"
              defaultChecked={values.isWorkAddress}
              disabled={pending}
              className="accent-brand size-4"
            />
            <span className="text-sm font-semibold">{copy.workAddress}</span>
          </label>
      </div>
    </div>
  );
}

function ParcelDetails({
  copy,
  pending,
  errors,
  values,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
}) {
  return (
    <Section
      icon={Package}
      title={copy.parcelTitle}
      tone="customer"
      description={copy.parcelDescription}
    >
      <FieldGroup>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{copy.parcelSize}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PARCEL_SIZES.map((size) => (
              <label
                key={size}
                className="border-input has-[:checked]:border-brand has-[:checked]:bg-brand/5 flex cursor-pointer items-center justify-center rounded-xl border px-3 py-4 text-center text-sm font-semibold transition-colors has-[:checked]:ring-3 has-[:checked]:ring-brand/20"
              >
                <input
                  type="radio"
                  name="parcelSize"
                  value={size}
                  defaultChecked={values.parcelSize === size}
                  disabled={pending}
                  className="sr-only"
                />
                {copy.sizes[size]}
              </label>
            ))}
          </div>
          {errors.parcelSize ? <FieldError>{errors.parcelSize}</FieldError> : null}
        </fieldset>
        <PiecesStepper
          label={copy.pieces}
          pending={pending}
          defaultValue={values.piecesCount}
          error={errors.piecesCount}
        />
        <OptionalArea
          id="productDescription"
          label={copy.productDescription}
          pending={pending}
          defaultValue={values.productDescription}
          error={errors.productDescription}
          maxLength={240}
        />
        <Field data-invalid={invalid(errors, "productImageUrl")}>
          <FieldLabel htmlFor="productImage">{copy.productImage}</FieldLabel>
          <Input
            id="productImage"
            name="productImage"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={pending}
            className="h-11 py-2"
          />
          <FieldDescription>{copy.productImageHint}</FieldDescription>
          <Input
            id="productImageUrl"
            name="productImageUrl"
            type="url"
            inputMode="url"
            dir="ltr"
            autoComplete="off"
            disabled={pending}
            defaultValue={values.productImageUrl}
            aria-invalid={invalid(errors, "productImageUrl")}
            placeholder="https://"
            className="mt-2 h-11 text-start"
          />
          <FieldDescription>{copy.productImageUrl}</FieldDescription>
          {errors.productImageUrl ? <FieldError>{errors.productImageUrl}</FieldError> : null}
        </Field>
        <label className="border-brand/30 bg-brand/5 has-[:checked]:border-brand flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4">
          <input
            type="checkbox"
            name="allowOpening"
            value="yes"
            defaultChecked={values.allowOpening}
            disabled={pending}
            className="accent-brand mt-0.5 size-4"
          />
          <span className="text-sm font-bold">{copy.allowOpening}</span>
        </label>
      </FieldGroup>
    </Section>
  );
}

function OrderNotes({
  copy,
  pending,
  errors,
  values,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
}) {
  return (
    <Section
      icon={StickyNote}
      title={copy.notesTitle}
      tone="customer"
      description={copy.notesDescription}
    >
      <FieldGroup>
        <OptionalArea
          id="deliveryNotes"
          label={copy.deliveryNotes}
          hint={copy.deliveryNotesHint}
          pending={pending}
          defaultValue={values.deliveryNotes}
          error={errors.deliveryNotes}
          maxLength={240}
          placeholder="يرجى التواصل مع العميل قبل التحرك"
        />
        <OptionalArea
          id="internalNotes"
          label={copy.internalNotes}
          hint={copy.internalNotesHint}
          pending={pending}
          defaultValue={values.internalNotes}
          error={errors.internalNotes}
          maxLength={240}
        />
      </FieldGroup>
    </Section>
  );
}

function PiecesStepper({
  label,
  pending,
  defaultValue,
  error,
}: {
  label: string;
  pending: boolean;
  defaultValue: string;
  error?: string;
}) {
  const start = Number(defaultValue);
  const [count, setCount] = useState(Number.isInteger(start) && start >= 1 && start <= 99 ? start : 1);
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="border-input flex size-11 items-center justify-center rounded-xl border"
          disabled={pending || count <= 1}
          onClick={() => setCount((current) => Math.max(1, current - 1))}
          aria-label="-"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-8 text-center text-lg font-bold tabular-nums">{count}</span>
        <button
          type="button"
          className="border-input flex size-11 items-center justify-center rounded-xl border"
          disabled={pending || count >= 99}
          onClick={() => setCount((current) => Math.min(99, current + 1))}
          aria-label="+"
        >
          <Plus className="size-4" />
        </button>
        <input type="hidden" name="piecesCount" value={count} />
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function OptionalLine({
  id,
  label,
  pending,
  defaultValue,
  error,
  maxLength,
}: {
  id: "buildingName" | "floorNumber" | "apartmentNumber" | "landmark";
  label: string;
  pending: boolean;
  defaultValue: string;
  error?: string;
  maxLength: number;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={id}
        autoComplete="off"
        disabled={pending}
        defaultValue={defaultValue}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        className="h-11"
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function OptionalArea({
  id,
  label,
  hint,
  pending,
  defaultValue,
  error,
  maxLength,
  placeholder,
}: {
  id: "productDescription" | "deliveryNotes" | "internalNotes";
  label: string;
  hint?: string;
  pending: boolean;
  defaultValue: string;
  error?: string;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        name={id}
        disabled={pending}
        defaultValue={defaultValue}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className="border-input min-h-24 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function PaymentFields({
  copy,
  pending,
  errors,
  values,
}: {
  copy: Copy;
  pending: boolean;
  errors: Errors;
  values: CreateOrderValues;
}) {
  const options = [
    { value: "cod" as const, title: copy.codTitle, description: copy.codDescription },
    { value: "prepaid" as const, title: copy.prepaidTitle, description: copy.prepaidDescription },
  ];
  return (
    <Section
      icon={Wallet}
      title={copy.paymentTitle}
      tone="customer"
      description={copy.paymentDescription}
    >
      <FieldGroup>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{copy.paymentType}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {options.map((option) => (
              <label
                key={option.value}
                className="border-input has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:focus-visible]:ring-brand/40 flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 transition-colors has-[:checked]:ring-3 has-[:checked]:ring-brand/20"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="paymentType"
                    value={option.value}
                    defaultChecked={values.paymentType === option.value}
                    disabled={pending}
                    className="accent-brand size-4"
                  />
                  <span className="text-sm font-semibold">{option.title}</span>
                </span>
                <span className="text-muted-foreground ps-6 text-xs leading-relaxed">
                  {option.description}
                </span>
              </label>
            ))}
          </div>
          {errors.paymentType ? <FieldError>{errors.paymentType}</FieldError> : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            id="productPrice"
            label={copy.productPrice}
            placeholder="45000"
            pending={pending}
            defaultValue={values.productPrice}
            error={errors.productPrice}
          />
          <MoneyField
            id="deliveryFee"
            label={copy.deliveryFee}
            placeholder="3000"
            pending={pending}
            defaultValue={values.deliveryFee}
            error={errors.deliveryFee}
          />
        </div>
      </FieldGroup>
    </Section>
  );
}

function NoteField({
  id,
  label,
  pending,
  defaultValue,
  error,
}: {
  id: "newItemNote" | "returnItemNote";
  label: string;
  pending: boolean;
  defaultValue: string;
  error?: string;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={id}
        autoComplete="off"
        required
        disabled={pending}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        className="h-11"
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function MapField({
  id,
  label,
  hint,
  pending,
  defaultValue,
  error,
}: {
  id: "pickupGpsUrl" | "dropoffGpsUrl";
  label: string;
  hint?: string;
  pending: boolean;
  defaultValue: string;
  error?: string;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={id}
        type="url"
        inputMode="url"
        dir="ltr"
        autoComplete="off"
        disabled={pending}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        placeholder="https://maps.app.goo.gl/…"
        className="h-11 text-start"
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function ReadonlyFact({
  label,
  value,
  ltr = false,
  missing,
  settings,
}: {
  label: string;
  value: string;
  ltr?: boolean;
  missing: string;
  settings: string;
}) {
  const empty = value.trim().length === 0;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        readOnly
        tabIndex={-1}
        autoComplete="off"
        value={empty ? "" : value}
        dir={ltr ? "ltr" : undefined}
        placeholder={missing}
        className={cn("h-11 bg-muted", ltr && "text-start")}
      />
      {empty ? (
        <FieldDescription>
          <Link href="/merchant/settings" className="text-brand font-medium hover:underline">
            {settings}
          </Link>
        </FieldDescription>
      ) : null}
    </Field>
  );
}

function MoneyField({
  id,
  label,
  placeholder,
  pending,
  defaultValue,
  error,
}: {
  id: "productPrice" | "deliveryFee";
  label: string;
  placeholder: string;
  pending: boolean;
  defaultValue: string;
  error?: string;
}) {
  const { m } = useLocale();
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          name={id}
          inputMode="decimal"
          autoComplete="off"
          required
          disabled={pending}
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          placeholder={placeholder}
          className="h-11 pe-12"
        />
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm">
          {m.orderForm.currency}
        </span>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  description,
  tone,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  hint?: string;
  description: string;
  tone: "saved" | "return" | "customer";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-5 shadow-sm",
        tone === "saved" && "border-border bg-muted/50",
        tone === "return" && "border-gold/40 bg-gold/10",
        tone === "customer" && "border-border bg-card border-t-brand border-t-2",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              tone === "customer" ? "bg-brand/10 text-brand" : "bg-background text-foreground",
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-bold">{title}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
          </div>
        </div>
        {hint ? (
          <span className="bg-background text-muted-foreground shrink-0 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
