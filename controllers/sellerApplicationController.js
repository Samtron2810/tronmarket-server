import SellerApplication from "../models/SellerApplication.js";
import User from "../models/User.js";

function applicationView(application) {
  const data =
    typeof application.toObject === "function"
      ? application.toObject()
      : { ...application };
  const user = data.user;
  if (user && typeof user === "object") {
    data.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }
  return data;
}

// POST /api/seller-applications — a customer applies to sell.
export const createSellerApplication = async (req, res) => {
  try {
    if (!["customer"].includes(req.user.role)) {
      return res.status(400).json({
        message:
          req.user.role === "seller"
            ? "You already have a seller account."
            : "Only customer accounts can apply to become a seller.",
      });
    }

    const pending = await SellerApplication.findOne({
      user: req.user._id,
      status: "pending",
    });
    if (pending) {
      return res.status(409).json({
        message: "You already have an application under review.",
        application: applicationView(pending),
      });
    }

    const application = await SellerApplication.create({
      user: req.user._id,
      storeName: req.body.storeName,
      businessDescription: req.body.businessDescription,
      contactPhone: req.body.contactPhone,
    });

    res.status(201).json({
      message: "Application submitted. Our team will review it shortly.",
      application: applicationView(application),
    });
  } catch (error) {
    console.error("createSellerApplication:", error);
    res.status(500).json({ message: error.message });
  }
};

// GET /api/seller-applications/mine — the applicant's latest application.
export const getMySellerApplication = async (req, res) => {
  try {
    const application = await SellerApplication.findOne({
      user: req.user._id,
    }).sort("-createdAt");

    res.json({ application: application ? applicationView(application) : null });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/admin/seller-applications — admin review queue.
export const getSellerApplications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (["pending", "approved", "rejected"].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [applications, total] = await Promise.all([
      SellerApplication.find(filter)
        .populate("user", "name email role")
        .sort("-createdAt")
        .skip(skip)
        .limit(limit),
      SellerApplication.countDocuments(filter),
    ]);

    res.json({
      applications: applications.map(applicationView),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/seller-applications/:id — approve or reject.
// Approval promotes the applicant to `seller` in the same step.
export const reviewSellerApplication = async (req, res) => {
  try {
    const { status, reviewNote } = req.body;

    const application = await SellerApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }
    if (application.status !== "pending") {
      return res.status(409).json({
        message: `This application has already been ${application.status}.`,
      });
    }

    const applicant = await User.findById(application.user);
    if (!applicant || applicant.accountStatus === "deleted") {
      return res
        .status(404)
        .json({ message: "The applicant's account no longer exists" });
    }

    if (status === "approved" && applicant.role === "customer") {
      applicant.role = "seller";
      await applicant.save();
    }

    application.status = status;
    application.reviewNote = reviewNote || "";
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    await application.save();

    const populated = await SellerApplication.findById(application._id)
      .populate("user", "name email role")
      .populate("reviewedBy", "name email");

    res.json({
      message:
        status === "approved"
          ? "Application approved. The user is now a seller."
          : "Application rejected.",
      application: applicationView(populated),
    });
  } catch (error) {
    console.error("reviewSellerApplication:", error);
    res.status(500).json({ message: error.message });
  }
};
