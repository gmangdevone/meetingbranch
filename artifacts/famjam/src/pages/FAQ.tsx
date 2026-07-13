import { HelpCircle, ChevronDown } from "lucide-react";
import { useState } from "react";

const faqData = [
  {
    question: "Where is the reunion being held?",
    answer: "The 2027 Lacey Family Reunion will be held in Atlanta, Georgia. Main events will take place at Centennial Olympic Park and the Westin Peachtree Plaza. More specific location details will be available on the Schedule page closer to the date."
  },
  {
    question: "When is the deadline to register and pay?",
    answer: "Please register your family and submit your $50/person payment by May 1st, 2027 to ensure we have an accurate headcount for catering and t-shirt orders."
  },
  {
    question: "How do I pay the registration fee?",
    answer: "The preferred method of payment is Cash App to $goudycgp. You can find a direct link on your registration confirmation page. Please be sure to include your name and sibling branch in the payment note!"
  },
  {
    question: "What does the $50 registration fee cover?",
    answer: "The fee covers your official 2027 FamJam t-shirt, all catered meals throughout the weekend (including the Saturday banquet), venue rentals, and entertainment."
  },
  {
    question: "Can I bring a plus one?",
    answer: "Yes! Significant others and close friends are welcome. Just be sure to add them to your registration form and pay their $50 registration fee so they get a t-shirt and meals."
  },
  {
    question: "Who should I contact if I have dietary restrictions?",
    answer: "There is a 'Dietary Restrictions' field on the registration form for each attendee. If you have severe allergies or specific concerns, please fill that out, and the food committee will ensure you have safe options."
  }
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="mb-10 text-center">
        <div className="w-16 h-16 bg-accent/20 text-accent-foreground rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
          <HelpCircle className="w-8 h-8" />
        </div>
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-4">Frequently Asked Questions</h1>
        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
          Got questions? We've got answers. If you don't see what you're looking for, reach out to your branch representative.
        </p>
      </div>

      <div className="space-y-4">
        {faqData.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <div 
              key={index}
              className={`bg-card border shadow-sm rounded-3xl overflow-hidden transition-all duration-300 ${
                isOpen ? 'ring-2 ring-primary/20 border-primary/30' : 'hover:border-primary/30'
              }`}
            >
              <button
                className="w-full px-6 py-5 flex items-center justify-between text-left focus:outline-none"
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span className="font-bold text-lg pr-8">{faq.question}</span>
                <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
              </button>
              
              <div 
                className={`transition-all duration-300 ease-in-out ${
                  isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-6 pb-6 pt-2 text-muted-foreground leading-relaxed border-t border-input/30 mx-6">
                  {faq.answer}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
