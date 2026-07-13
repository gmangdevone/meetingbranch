export function FAQ() {
  return (
    <div className="max-w-3xl mx-auto py-12">
      <div className="text-center mb-12">
        <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4 text-foreground">Frequently Asked Questions</h1>
        <p className="text-lg text-muted-foreground">Everything you need to know about using FamJam.</p>
      </div>

      <div className="space-y-6">
        <div className="bg-card border shadow-sm rounded-3xl p-8">
          <h3 className="font-bold text-xl mb-3 text-primary">How do I register for my family's reunion?</h3>
          <p className="text-muted-foreground leading-relaxed">
            First, ask your family organizer for your unique 7-character reunion code (e.g., ABCDEFG). 
            Click "Join" in the menu, enter the code, and click "Register My Household". You'll be able to add 
            all members of your immediate family, select t-shirt sizes, and note any dietary restrictions.
          </p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-8">
          <h3 className="font-bold text-xl mb-3 text-secondary">How do payments work?</h3>
          <p className="text-muted-foreground leading-relaxed">
            FamJam calculates the total cost for your household based on the per-person fee set by your organizer. 
            Once you register, you'll see the payment instructions (usually a Cash App, Venmo, or PayPal link). 
            Send your payment outside of FamJam, and the organizer will manually mark your registration as "Paid" once they receive it.
          </p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-8">
          <h3 className="font-bold text-xl mb-3 text-primary">Can I organize my own family reunion?</h3>
          <p className="text-muted-foreground leading-relaxed">
            Yes! FamJam is built for any family to use. Just create an account, click "Create a Reunion", 
            and fill in your dates and details. You'll instantly get a shareable code to send to your relatives.
          </p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-8">
          <h3 className="font-bold text-xl mb-3 text-secondary">What if I need to change my registration?</h3>
          <p className="text-muted-foreground leading-relaxed">
            If you've already submitted your registration and need to add someone or change a t-shirt size, 
            please contact your family reunion organizer directly. They have the ability to view and manage all registrations.
          </p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-8">
          <h3 className="font-bold text-xl mb-3 text-primary">How do family branches work?</h3>
          <p className="text-muted-foreground leading-relaxed">
            Organizers set up branches (e.g., "Descendants of John", "The Smith Side") so they can track attendance 
            and organize competitions or seating charts. When you register, you simply pick which branch your household belongs to.
          </p>
        </div>
      </div>
    </div>
  );
}
