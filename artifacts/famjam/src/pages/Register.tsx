import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateRegistration } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { SiblingName, ShirtSize } from "@workspace/api-client-react";
import { Plus, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { queryClient } from "../lib/queryClient";
import { getListMyRegistrationsQueryKey } from "@workspace/api-client-react";

const attendeeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  shirtSize: z.nativeEnum(ShirtSize),
  dietaryRestrictions: z.string().optional(),
});

const registrationSchema = z.object({
  siblingName: z.nativeEnum(SiblingName, { required_error: "Please select a branch" }),
  attendees: z.array(attendeeSchema).min(1, "At least one attendee is required"),
});

type FormValues = z.infer<typeof registrationSchema>;

export function Register() {
  const [, setLocation] = useLocation();
  const createRegistration = useCreateRegistration();

  const form = useForm<FormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      siblingName: undefined,
      attendees: [{ name: "", shirtSize: ShirtSize.L, dietaryRestrictions: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "attendees",
  });

  const onSubmit = (data: FormValues) => {
    createRegistration.mutate(
      { data },
      {
        onSuccess: (reg) => {
          queryClient.invalidateQueries({ queryKey: getListMyRegistrationsQueryKey() });
          setLocation(`/registrations/${reg.id}`);
        },
      }
    );
  };

  const { handleSubmit, register, formState: { errors } } = form;

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="mb-8">
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-secondary mb-4">Register for FamJam</h1>
        <p className="text-muted-foreground text-lg">
          We're excited to see you! Registration is $50 per person (includes all meals, activities, and your reunion t-shirt).
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-10">
        <div className="bg-card border shadow-sm rounded-3xl p-6 md:p-8">
          <h2 className="font-serif text-2xl font-bold mb-6">Family Branch</h2>
          <div className="space-y-2">
            <label className="block text-sm font-bold text-foreground">Which sibling branch are you from?</label>
            <select
              {...register("siblingName")}
              className="w-full bg-input/30 border-transparent focus:border-primary focus:ring-primary rounded-xl px-4 py-3 appearance-none font-medium"
            >
              <option value="">Select a branch...</option>
              {Object.values(SiblingName).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {errors.siblingName && <p className="text-destructive text-sm font-medium">{errors.siblingName.message}</p>}
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-2xl font-bold">Attendees</h2>
            <div className="bg-secondary/10 text-secondary px-4 py-1.5 rounded-full font-bold text-sm">
              {fields.length} {fields.length === 1 ? 'Person' : 'People'}
            </div>
          </div>

          {fields.map((field, index) => (
            <div key={field.id} className="bg-card border shadow-sm rounded-3xl p-6 md:p-8 relative animate-in slide-in-from-bottom-4 duration-300">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="absolute top-6 right-6 text-muted-foreground hover:text-destructive transition-colors p-2 rounded-full hover:bg-destructive/10"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              
              <h3 className="font-bold text-lg mb-4 text-primary">Attendee #{index + 1}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 md:col-span-2">
                  <label className="block text-sm font-bold text-foreground">Full Name</label>
                  <input
                    {...register(`attendees.${index}.name`)}
                    className="w-full bg-input/30 border-transparent focus:border-primary focus:ring-primary rounded-xl px-4 py-3 font-medium"
                    placeholder="e.g. Jane Doe"
                  />
                  {errors.attendees?.[index]?.name && (
                    <p className="text-destructive text-sm font-medium">{errors.attendees[index]?.name?.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-bold text-foreground">T-Shirt Size</label>
                  <select
                    {...register(`attendees.${index}.shirtSize`)}
                    className="w-full bg-input/30 border-transparent focus:border-primary focus:ring-primary rounded-xl px-4 py-3 appearance-none font-medium"
                  >
                    {Object.values(ShirtSize).map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="block text-sm font-bold text-foreground">Dietary Restrictions (Optional)</label>
                  <textarea
                    {...register(`attendees.${index}.dietaryRestrictions`)}
                    className="w-full bg-input/30 border-transparent focus:border-primary focus:ring-primary rounded-xl px-4 py-3 font-medium resize-none min-h-[100px]"
                    placeholder="e.g. Vegetarian, Peanut allergy..."
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => append({ name: "", shirtSize: ShirtSize.L, dietaryRestrictions: "" })}
            className="w-full py-6 border-2 border-dashed border-primary/30 rounded-3xl text-primary font-bold text-lg flex items-center justify-center gap-2 hover:bg-primary/5 hover:border-primary/50 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Another Attendee
          </button>
        </div>

        <div className="bg-accent/20 border border-accent/30 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-foreground/70 font-medium mb-1">Total Due Registration Fee:</p>
            <p className="font-serif text-4xl font-bold text-foreground">
              ${fields.length * 50}.00
            </p>
          </div>
          <button
            type="submit"
            disabled={createRegistration.isPending}
            className="bg-primary text-primary-foreground px-8 py-4 rounded-full font-bold text-lg shadow-md hover:bg-primary/90 transition-all w-full md:w-auto flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {createRegistration.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                Complete Registration
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
